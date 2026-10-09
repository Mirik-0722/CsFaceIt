//! Where the demo files come from: an S3-compatible server (MinIO) that the backend writes to. An object is always a
//! zstd stream; it is copied to a temporary file and decompressed to another one, so that a demo of several hundred
//! megabytes is never held in memory.

use std::error::Error;
use std::fmt;
use std::fs::File;
use std::io::{self, BufWriter, Read, Write};
use std::path::Path;
use std::time::Duration;

use aws_sdk_s3::config::timeout::TimeoutConfig;
use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region};
use aws_sdk_s3::error::SdkError;
use aws_sdk_s3::Client;
use tokio::io::AsyncWriteExt;

use crate::config::Config;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// The longest silence between two reads of a response, not the duration of a whole download.
const READ_TIMEOUT: Duration = Duration::from_secs(60);

const DECOMPRESS_BUFFER: usize = 128 * 1024;

pub struct Storage {
    client: Client,
    bucket: String,
}

#[derive(Debug)]
pub enum DownloadError {
    /// The server answered that there is no such object.
    Missing,
    /// The object is larger than the limit.
    TooLarge,
    /// The server answered that the request is wrong (a 4xx status): asking again will not change that. The text is
    /// for the log.
    Refused(String),
    /// The server could not be reached, failed, or the transfer broke off: asking again may work.
    Unavailable(String),
    /// The temporary file could not be written.
    Io(io::Error),
}

impl fmt::Display for DownloadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DownloadError::Missing => write!(f, "the object does not exist"),
            DownloadError::TooLarge => write!(f, "the object is larger than the limit"),
            DownloadError::Refused(detail) => {
                write!(f, "the storage refused the request: {detail}")
            }
            DownloadError::Unavailable(detail) => write!(f, "the storage request failed: {detail}"),
            DownloadError::Io(e) => write!(f, "the temporary file could not be written: {e}"),
        }
    }
}

#[derive(Debug)]
pub enum DecompressError {
    /// The data is not a complete zstd stream.
    Corrupt(io::Error),
    /// The data expands beyond the limit.
    TooLarge,
    /// A temporary file could not be opened or written.
    Io(io::Error),
}

impl fmt::Display for DecompressError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DecompressError::Corrupt(e) => {
                write!(f, "the stored object is not a valid zstd stream: {e}")
            }
            DecompressError::TooLarge => write!(f, "the demo expands beyond the limit"),
            DecompressError::Io(e) => write!(f, "a temporary file could not be used: {e}"),
        }
    }
}

impl Storage {
    pub fn new(config: &Config) -> Self {
        let credentials = Credentials::new(
            &config.s3_access_key,
            &config.s3_secret_key,
            None,
            None,
            "environment",
        );
        let timeouts = TimeoutConfig::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .build();
        let s3 = aws_sdk_s3::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new(config.s3_region.clone()))
            .endpoint_url(&config.s3_endpoint)
            .credentials_provider(credentials)
            // http://minio:9000/bucket/key instead of http://bucket.minio:9000/key
            .force_path_style(true)
            .timeout_config(timeouts)
            .build();
        Storage {
            client: Client::from_conf(s3),
            bucket: config.s3_bucket.clone(),
        }
    }

    /// Copies the object `key` to the file `target` and returns its size. At most `max_bytes` are accepted, counted
    /// as they arrive.
    pub async fn download(
        &self,
        key: &str,
        target: &Path,
        max_bytes: u64,
    ) -> Result<u64, DownloadError> {
        let response = match self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
        {
            Ok(response) => response,
            Err(SdkError::ServiceError(e)) if e.err().is_no_such_key() => {
                return Err(DownloadError::Missing)
            }
            Err(SdkError::ServiceError(e)) if (400..500).contains(&e.raw().status().as_u16()) => {
                let status = e.raw().status().as_u16();
                return Err(DownloadError::Refused(format!(
                    "HTTP {status}: {}",
                    describe(e.err())
                )));
            }
            Err(e) => return Err(DownloadError::Unavailable(describe(&e))),
        };
        if response
            .content_length()
            .is_some_and(|length| length > 0 && length as u64 > max_bytes)
        {
            return Err(DownloadError::TooLarge);
        }

        let mut body = response.body;
        let mut file = tokio::fs::File::create(target)
            .await
            .map_err(DownloadError::Io)?;
        let mut total: u64 = 0;
        loop {
            let chunk = match body.try_next().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(e) => return Err(DownloadError::Unavailable(describe(&e))),
            };
            total += chunk.len() as u64;
            if total > max_bytes {
                return Err(DownloadError::TooLarge);
            }
            file.write_all(&chunk).await.map_err(DownloadError::Io)?;
        }
        file.flush().await.map_err(DownloadError::Io)?;
        Ok(total)
    }
}

/// Decompresses the zstd file `source` into the file `target` and returns the decompressed size. The bytes are counted
/// as they are written and the work stops once they exceed `max_bytes`: the stored object comes from an upload, so it
/// may be a small file that expands without end.
///
/// This blocks; call it from a blocking task.
pub fn decompress(source: &Path, target: &Path, max_bytes: u64) -> Result<u64, DecompressError> {
    let input = File::open(source).map_err(DecompressError::Io)?;
    let mut decoder = zstd::stream::read::Decoder::new(input).map_err(DecompressError::Io)?;
    let mut output = BufWriter::new(File::create(target).map_err(DecompressError::Io)?);
    let mut buffer = vec![0u8; DECOMPRESS_BUFFER];
    let mut total: u64 = 0;
    loop {
        // A failure here is the decoder rejecting the data. (It could also be the disk failing to give back the
        // temporary file written a moment ago, which is not worth telling apart.)
        let read = match decoder.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => read,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(DecompressError::Corrupt(e)),
        };
        total += read as u64;
        if total > max_bytes {
            return Err(DecompressError::TooLarge);
        }
        output
            .write_all(&buffer[..read])
            .map_err(DecompressError::Io)?;
    }
    output.flush().map_err(DecompressError::Io)?;
    Ok(total)
}

/// The messages of an error and of everything that caused it. Only `Display` is used: the `Debug` form of an SDK
/// error prints the whole HTTP exchange.
fn describe(error: &dyn Error) -> String {
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    text
}
