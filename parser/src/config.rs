//! The settings of the worker. All of them come from the environment and are read once, at startup.

use std::env;
use std::fmt;

/// The most a demo may be once decompressed when `PARSER_MAX_DEMO_BYTES` is not set: 2 GiB.
pub const DEFAULT_MAX_DEMO_BYTES: u64 = 2 * 1024 * 1024 * 1024;

const MAX_DEMO_BYTES: &str = "PARSER_MAX_DEMO_BYTES";

/// Deliberately without `Debug`: it holds credentials and must never end up in a log line.
pub struct Config {
    /// `amqp://user:password@host:5672/%2f`
    pub amqp_url: String,
    /// `postgres://user:password@host:5432/database`
    pub database_url: String,
    /// The address of the S3-compatible server, such as `http://minio:9000`; it is addressed path-style.
    pub s3_endpoint: String,
    pub s3_access_key: String,
    pub s3_secret_key: String,
    pub s3_bucket: String,
    pub s3_region: String,
    /// The most a stored object may be, and the most it may decompress to.
    pub max_demo_bytes: u64,
}

/// Names the variable that is wrong, never its value: most of them carry a password.
#[derive(Debug)]
pub enum ConfigError {
    Missing(&'static str),
    Invalid {
        name: &'static str,
        expected: &'static str,
    },
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::Missing(name) => write!(f, "the environment variable {name} is not set"),
            ConfigError::Invalid { name, expected } => {
                write!(
                    f,
                    "the environment variable {name} is not valid: expected {expected}"
                )
            }
        }
    }
}

impl std::error::Error for ConfigError {}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Ok(Config {
            amqp_url: required("AMQP_URL")?,
            database_url: required("DATABASE_URL")?,
            s3_endpoint: required("S3_ENDPOINT")?,
            s3_access_key: required("S3_ACCESS_KEY")?,
            s3_secret_key: required("S3_SECRET_KEY")?,
            s3_bucket: required("S3_BUCKET")?,
            s3_region: required("S3_REGION")?,
            max_demo_bytes: max_demo_bytes(env::var(MAX_DEMO_BYTES).ok())?,
        })
    }
}

/// A variable that is set but blank is as good as missing.
fn required(name: &'static str) -> Result<String, ConfigError> {
    match env::var(name) {
        Ok(value) if !value.trim().is_empty() => Ok(value),
        _ => Err(ConfigError::Missing(name)),
    }
}

fn max_demo_bytes(value: Option<String>) -> Result<u64, ConfigError> {
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return Ok(DEFAULT_MAX_DEMO_BYTES);
    };
    match value.trim().parse::<u64>() {
        Ok(bytes) if bytes > 0 => Ok(bytes),
        _ => Err(ConfigError::Invalid {
            name: MAX_DEMO_BYTES,
            expected: "a positive number of bytes",
        }),
    }
}
