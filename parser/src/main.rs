//! The demo parser worker. It takes the demos announced on `demo.parse`, reads each one from storage, parses it and
//! writes the facts to PostgreSQL, then announces the demo on `demo.parsed`. RabbitMQ, the object storage and the
//! database are all it shares with the backend.
//!
//! Delivery is at least once and a demo can be announced again at any time, so a message is only acted on while its
//! demo is STORED; see `sink`. One message is handled at a time.

mod bins;
mod config;
mod messages;
mod parse;
mod sink;
mod storage;

use std::fmt;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::str::FromStr;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use lapin::message::Delivery;
use lapin::options::{
    BasicAckOptions, BasicCancelOptions, BasicConsumeOptions, BasicPublishOptions, BasicQosOptions,
    BasicRejectOptions, ConfirmSelectOptions, QueueDeclareOptions,
};
use lapin::types::FieldTable;
use lapin::uri::AMQPUri;
use lapin::{BasicProperties, Channel, Confirmation, Connection, ConnectionProperties};
use sqlx::PgPool;
use tempfile::NamedTempFile;
use tokio::signal::unix::{signal, SignalKind};
use tokio::sync::watch;
use tracing::{debug, error, info, warn};
use tracing_subscriber::EnvFilter;

use crate::bins::HeatBin;
use crate::config::Config;
use crate::messages::{DemoParsed, DemoStored};
use crate::parse::{Facts, ParseError};
use crate::sink::{Counts, Written};
use crate::storage::{DecompressError, DownloadError, Storage};

/// What `demos.error` says. Users read it through the API, so these are the only texts that ever go there; the
/// technical detail of a failure is logged instead.
const ERROR_NOT_A_DEMO: &str = "Demo could not be parsed: the file is not a valid CS2 demo.";
const ERROR_MISSING: &str = "Demo could not be parsed: the stored file is missing.";
const ERROR_TOO_LARGE: &str = "Demo could not be parsed: the file is too large.";
const ERROR_INTERNAL: &str = "Demo could not be parsed: internal error.";

const CONNECTION_NAME: &str = "csfaceit-parser";
const CONSUMER_TAG: &str = "csfaceit-parser";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// How long to wait before connecting to the broker again; it doubles up to the maximum from one failed connection to
/// the next, see [`Worker::run`].
const RECONNECT_MIN: Duration = Duration::from_secs(1);
const RECONNECT_MAX: Duration = Duration::from_secs(30);
/// How often to look whether the backend has declared the queue yet.
const QUEUE_POLL: Duration = Duration::from_secs(3);
/// The broker confirms a publish within milliseconds; longer than this and the connection is taken for dead.
const PUBLISH_TIMEOUT: Duration = Duration::from_secs(15);

/// The waits after the failed attempts at a message when storage or the database is away. After the last one the
/// message goes back to the queue, see [`Worker::process_with_retries`].
const RETRY_DELAYS: [Duration; 4] = [
    Duration::from_secs(5),
    Duration::from_secs(10),
    Duration::from_secs(20),
    Duration::from_secs(40),
];

/// The directory under the system's temporary directory that holds the files of the demo being parsed.
const WORK_DIR: &str = "csfaceit-parser";

/// Becomes true when the process is asked to stop.
type Stop = watch::Receiver<bool>;

#[tokio::main]
async fn main() -> ExitCode {
    // The AMQP client logs every closed channel as an error, which is how the broker answers the question whether a
    // queue exists; the worker reports the failures that matter itself.
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("warn,lapin::channel=off,csfaceit_parser=info"));
    // Colors only for a person at a terminal; a container's log stays plain text.
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_ansi(std::io::stdout().is_terminal())
        .init();

    let worker = match Worker::from_env() {
        Ok(worker) => worker,
        Err(e) => {
            error!("cannot start: {e}");
            return ExitCode::from(2);
        }
    };

    let (stop_sender, stop) = watch::channel(false);
    tokio::spawn(async move {
        wait_for_signal().await;
        info!("stop requested; finishing the demo in progress, if any");
        let _ = stop_sender.send(true);
    });

    worker.run(stop).await;
    info!("stopped");
    ExitCode::SUCCESS
}

/// Resolves on SIGTERM (`docker stop`) or SIGINT (Ctrl-C).
async fn wait_for_signal() {
    match (
        signal(SignalKind::terminate()),
        signal(SignalKind::interrupt()),
    ) {
        (Ok(mut terminate), Ok(mut interrupt)) => {
            tokio::select! {
                _ = terminate.recv() => {}
                _ = interrupt.recv() => {}
            }
        }
        _ => {
            warn!("cannot listen for termination signals; the worker stops only when it is killed");
            std::future::pending::<()>().await;
        }
    }
}

/// Resolves once a stop has been requested.
async fn stopped(stop: &mut Stop) {
    // An error means the sender is gone, which only happens after it has sent the request.
    let _ = stop.wait_for(|requested| *requested).await;
}

/// Sleeps for `duration`; returns true when a stop was requested meanwhile.
async fn sleep_unless_stopped(duration: Duration, stop: &mut Stop) -> bool {
    tokio::select! {
        _ = stopped(stop) => true,
        _ = tokio::time::sleep(duration) => false,
    }
}

/// Why the worker cannot start. Like the configuration error it wraps, it never shows a value.
#[derive(Debug)]
enum StartError {
    Config(config::ConfigError),
    WorkDir(std::io::Error),
}

impl fmt::Display for StartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StartError::Config(e) => write!(f, "{e}"),
            StartError::WorkDir(e) => {
                write!(f, "the directory for temporary files cannot be used: {e}")
            }
        }
    }
}

/// A failure of the connection to the broker, or of an operation on it: the answer is to connect again.
#[derive(Debug)]
struct BrokerError(String);

impl fmt::Display for BrokerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<lapin::Error> for BrokerError {
    fn from(e: lapin::Error) -> Self {
        BrokerError(e.to_string())
    }
}

/// Why a demo could not be turned into facts.
enum Failure {
    /// The demo itself is the problem: `user` is what `demos.error` says, `detail` goes to the log.
    Demo { user: &'static str, detail: String },
    /// Storage, the database or the disk is in the way: trying again may work, and the demo is not to blame.
    Transient(String),
}

/// What became of one message.
enum Outcome {
    /// The facts are written and the demo is PARSED.
    Parsed(Counts),
    /// The demo could not be parsed and is FAILED with this text.
    Failed(&'static str),
    /// The demo was not STORED: a duplicate, or a message about a demo that has moved on.
    NotStored(String),
    /// The demo was stored again or changed status while the worker was busy: its result was dropped.
    OutOfDate,
    /// There is no demo with this id.
    Unknown,
    /// Storage or the database stayed away through every attempt: the message goes back to the queue.
    Requeue,
    /// A stop was requested while waiting for another attempt.
    Abandoned,
}

struct Worker {
    amqp: AMQPUri,
    pool: PgPool,
    storage: Storage,
    max_demo_bytes: u64,
    work_dir: PathBuf,
}

impl Worker {
    /// Reads the settings and prepares the clients. Nothing is connected yet: the broker, the database and storage
    /// are reached when they are first needed, and reached again whenever they come back.
    fn from_env() -> Result<Self, StartError> {
        let config = Config::from_env().map_err(StartError::Config)?;
        let invalid =
            |name, expected| StartError::Config(config::ConfigError::Invalid { name, expected });

        // Neither parser echoes the URL in its error, but nothing here relies on that: only the name is reported.
        let amqp = AMQPUri::from_str(&config.amqp_url).map_err(|_| {
            invalid(
                "AMQP_URL",
                "an AMQP URL such as amqp://user:password@host:5672/%2f",
            )
        })?;
        let (pool, database) = sink::connect(&config.database_url).map_err(|_| {
            invalid(
                "DATABASE_URL",
                "a PostgreSQL URL such as postgres://user:password@host:5432/database",
            )
        })?;
        if !(config.s3_endpoint.starts_with("http://")
            || config.s3_endpoint.starts_with("https://"))
        {
            return Err(invalid("S3_ENDPOINT", "an http:// or https:// address"));
        }

        let work_dir = std::env::temp_dir().join(WORK_DIR);
        prepare_work_dir(&work_dir).map_err(StartError::WorkDir)?;

        info!(
            broker = %format!("{}:{}", amqp.authority.host, amqp.authority.port),
            database = %database,
            bucket = %config.s3_bucket,
            max_demo_bytes = config.max_demo_bytes,
            "starting"
        );
        Ok(Worker {
            amqp,
            pool,
            storage: Storage::new(&config),
            max_demo_bytes: config.max_demo_bytes,
            work_dir,
        })
    }

    /// Serves until a stop is requested. When the broker cannot be reached, the connection is lost, or the work on it
    /// fails, a new connection is made after a pause. The pause doubles from one failure to the next and starts over
    /// only once a message has been settled: a connection that comes up but cannot get its work done (`demo.parsed`
    /// has no queue to go to, say) is not to be made again every second for as long as that lasts.
    async fn run(&self, mut stop: Stop) {
        let mut pause = RECONNECT_MIN;
        while !*stop.borrow() {
            let failure = match self.connect(&mut stop).await {
                Ok(None) => break,
                Ok(Some(connection)) => {
                    match self.consume(&connection, &mut stop, &mut pause).await {
                        Ok(()) => break,
                        // Leaving this arm drops the connection, which closes it if it is still open; the broker
                        // then puts the message that was not settled back in the queue.
                        Err(e) => format!("dropping the connection to the message broker ({e})"),
                    }
                }
                Err(e) => format!("cannot connect to the message broker ({e})"),
            };
            warn!("{failure}; connecting again in {pause:?}");
            if sleep_unless_stopped(pause, &mut stop).await {
                break;
            }
            pause = (pause * 2).min(RECONNECT_MAX);
        }
    }

    /// Connects to the broker. Returns `None` when a stop was requested meanwhile.
    async fn connect(&self, stop: &mut Stop) -> Result<Option<Connection>, BrokerError> {
        let properties =
            ConnectionProperties::default().with_connection_name(CONNECTION_NAME.into());
        let connecting = tokio::time::timeout(
            CONNECT_TIMEOUT,
            Connection::connect_uri(self.amqp.clone(), properties),
        );
        tokio::select! {
            _ = stopped(stop) => Ok(None),
            connection = connecting => {
                let connection = connection.map_err(|_| BrokerError("connecting timed out".to_string()))??;
                Ok(Some(connection))
            }
        }
    }

    /// Consumes `demo.parse` on `connection` until a stop is requested (`Ok`) or something on the connection fails.
    /// `pause`, the wait before the next connection, goes back to its minimum whenever a message has been settled.
    async fn consume(
        &self,
        connection: &Connection,
        stop: &mut Stop,
        pause: &mut Duration,
    ) -> Result<(), BrokerError> {
        let Some(channel) = self.wait_for_queue(connection, stop).await? else {
            close(connection).await;
            return Ok(());
        };
        // One unacknowledged message at a time: a demo takes all the cores and a good part of the memory.
        channel.basic_qos(1, BasicQosOptions::default()).await?;
        // The broker confirms every publish, so `demo.parsed` is known to be queued before `demo.parse` is acknowledged.
        channel
            .confirm_select(ConfirmSelectOptions::default())
            .await?;
        let mut consumer = channel
            .basic_consume(
                messages::PARSE_QUEUE.into(),
                CONSUMER_TAG.into(),
                BasicConsumeOptions::default(),
                FieldTable::default(),
            )
            .await?;
        info!(
            "connected to the message broker; consuming {}",
            messages::PARSE_QUEUE
        );

        loop {
            // A stop is looked at between two messages only: the message in progress is finished first.
            let delivery = tokio::select! {
                biased;
                _ = stopped(stop) => break,
                delivery = consumer.next() => delivery,
            };
            match delivery {
                Some(Ok(delivery)) => {
                    if !self.handle(&channel, delivery, stop).await? {
                        break;
                    }
                    // The broker took the acknowledgement or the rejection: this connection gets its work done.
                    *pause = RECONNECT_MIN;
                }
                Some(Err(e)) => return Err(e.into()),
                None => return Err(BrokerError("the broker cancelled the consumer".to_string())),
            }
        }

        // Leaving without acknowledging hands a message that was abandoned back to the queue.
        let _ = channel
            .basic_cancel(CONSUMER_TAG.into(), BasicCancelOptions::default())
            .await;
        close(connection).await;
        Ok(())
    }

    /// Opens a channel on which `demo.parse` is known to exist. The backend declares the exchange and the queues when
    /// it first connects; until then the worker looks again every few seconds, and never declares anything itself.
    /// Returns `None` when a stop was requested meanwhile.
    async fn wait_for_queue(
        &self,
        connection: &Connection,
        stop: &mut Stop,
    ) -> Result<Option<Channel>, BrokerError> {
        let mut announced = false;
        loop {
            let channel = connection.create_channel().await?;
            let exists = channel
                .queue_declare(
                    messages::PARSE_QUEUE.into(),
                    QueueDeclareOptions::default().passive(),
                    FieldTable::default(),
                )
                .await;
            match exists {
                Ok(_) => return Ok(Some(channel)),
                // The broker answers a missing queue by closing the channel, not the connection.
                Err(e) if e.is_amqp_soft_error() => {
                    if !announced {
                        info!("the queue {} does not exist yet; waiting for the backend to declare it", messages::PARSE_QUEUE);
                        announced = true;
                    }
                    debug!("checking for the queue failed: {e}");
                }
                Err(e) => return Err(e.into()),
            }
            if sleep_unless_stopped(QUEUE_POLL, stop).await {
                return Ok(None);
            }
        }
    }

    /// Handles one message and settles it with the broker. Returns false when the message was abandoned because a
    /// stop was requested; it is then neither acknowledged nor rejected, so the broker delivers it again.
    async fn handle(
        &self,
        channel: &Channel,
        delivery: Delivery,
        stop: &mut Stop,
    ) -> Result<bool, BrokerError> {
        let started = Instant::now();
        let message = match DemoStored::from_json(&delivery.data) {
            Ok(message) => message,
            Err(reason) => {
                warn!(bytes = delivery.data.len(), %reason, "rejecting a demo.parse message that cannot be read");
                delivery
                    .reject(BasicRejectOptions { requeue: false })
                    .await?;
                return Ok(true);
            }
        };
        let demo_id = message.demo_id;
        let match_id = message.faceit_match_id.as_str();
        debug!(demo_id, match_id, key = %message.storage_key, redelivered = delivery.redelivered, "received");

        let outcome = self.process_with_retries(&message, stop).await;
        let duration_ms = started.elapsed().as_millis() as u64;
        match outcome {
            Outcome::Parsed(counts) => {
                self.publish_parsed(channel, &message).await?;
                delivery.ack(BasicAckOptions::default()).await?;
                info!(
                    demo_id,
                    match_id,
                    outcome = "PARSED",
                    duration_ms,
                    rounds = counts.rounds,
                    kills = counts.kills,
                    damages = counts.damages,
                    heat_bins = counts.heat_bins,
                    players_created = counts.players_created,
                    "demo parsed"
                );
            }
            Outcome::Failed(error) => {
                delivery
                    .reject(BasicRejectOptions { requeue: false })
                    .await?;
                info!(
                    demo_id,
                    match_id,
                    outcome = "FAILED",
                    duration_ms,
                    error,
                    "demo failed"
                );
            }
            Outcome::NotStored(status) => {
                // The worker can die between committing PARSED and publishing `demo.parsed`; the broker then
                // delivers the message again, and this is where the lost announcement is made up for.
                let announce_again = delivery.redelivered && status == sink::PARSED;
                if announce_again {
                    self.publish_parsed(channel, &message).await?;
                }
                delivery.ack(BasicAckOptions::default()).await?;
                info!(demo_id, match_id, outcome = "DISCARDED", duration_ms, status = %status, announce_again, "the demo is not STORED");
            }
            Outcome::OutOfDate => {
                delivery.ack(BasicAckOptions::default()).await?;
                info!(
                    demo_id,
                    match_id,
                    outcome = "DISCARDED",
                    duration_ms,
                    "the demo changed while it was being parsed; the result was dropped"
                );
            }
            Outcome::Unknown => {
                delivery
                    .reject(BasicRejectOptions { requeue: false })
                    .await?;
                warn!(
                    demo_id,
                    match_id,
                    outcome = "REJECTED",
                    duration_ms,
                    "there is no such demo"
                );
            }
            Outcome::Requeue => {
                delivery
                    .reject(BasicRejectOptions { requeue: true })
                    .await?;
                error!(demo_id, match_id, outcome = "REQUEUED", duration_ms, "storage or the database is still unavailable; the message went back to the queue");
            }
            Outcome::Abandoned => {
                info!(
                    demo_id,
                    match_id,
                    outcome = "ABANDONED",
                    duration_ms,
                    "stopping; the broker will deliver the message again"
                );
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// Announces a parsed demo on `demo.parsed` and waits for the broker to confirm it.
    async fn publish_parsed(
        &self,
        channel: &Channel,
        message: &DemoStored,
    ) -> Result<(), BrokerError> {
        let body = DemoParsed {
            demo_id: message.demo_id,
            faceit_match_id: &message.faceit_match_id,
        }
        .to_json();
        // Persistent (delivery mode 2) JSON; the backend tells the type from its listener, not from a header.
        let properties = BasicProperties::default()
            .with_content_type("application/json".into())
            .with_delivery_mode(2);
        let publish = async {
            channel
                .basic_publish(
                    messages::EXCHANGE.into(),
                    messages::PARSED_ROUTING_KEY.into(),
                    // Mandatory: a message no queue would take is handed back instead of being dropped.
                    BasicPublishOptions {
                        mandatory: true,
                        ..BasicPublishOptions::default()
                    },
                    &body,
                    properties,
                )
                .await?
                .await
        };
        let confirmation = tokio::time::timeout(PUBLISH_TIMEOUT, publish)
            .await
            .map_err(|_| {
                BrokerError("the broker did not confirm demo.parsed in time".to_string())
            })??;
        match confirmation {
            Confirmation::Ack(None) => Ok(()),
            Confirmation::Ack(Some(_)) => Err(BrokerError(
                "demo.parsed could not be routed to a queue".to_string(),
            )),
            Confirmation::Nack(_) => Err(BrokerError("the broker refused demo.parsed".to_string())),
            Confirmation::NotRequested => Err(BrokerError(
                "the broker did not confirm demo.parsed".to_string(),
            )),
        }
    }

    /// Processes a message, again after a pause while the failure is one that may pass.
    ///
    /// A demo is never marked FAILED because storage or the database was away, and its message is never given up:
    /// the worker tries again after each of [`RETRY_DELAYS`] and then hands the message back to the queue, from where
    /// it returns at once for the next round. So an outage of any length is waited out, at most 40 seconds between
    /// two attempts. Rejecting the message instead would lose it exactly when nobody can record that: with the
    /// database away the backend's dead-letter listener cannot mark the demo either, and the demo would stay STORED
    /// with nothing left to announce it. The price is that a message which fails this way forever holds up the demos
    /// behind it, which is why only failures to reach a service count as passing; see [`sink::is_transient`] and
    /// [`DownloadError`].
    async fn process_with_retries(&self, message: &DemoStored, stop: &mut Stop) -> Outcome {
        for (attempt, delay) in RETRY_DELAYS.iter().enumerate() {
            let detail = match self.process(message).await {
                Ok(outcome) => return outcome,
                Err(detail) => detail,
            };
            warn!(demo_id = message.demo_id, attempt = attempt + 1, %detail, "could not process the demo; waiting {delay:?}");
            if sleep_unless_stopped(*delay, stop).await {
                return Outcome::Abandoned;
            }
        }
        Outcome::Requeue
    }

    /// One attempt at a message. The error is the detail of a failure that may pass.
    async fn process(&self, message: &DemoStored) -> Result<Outcome, String> {
        let demo_id = message.demo_id;
        let database = |e: sqlx::Error| format!("database: {e}");

        let Some(state) = sink::state(&self.pool, demo_id).await.map_err(database)? else {
            return Ok(Outcome::Unknown);
        };
        if state.status != sink::STORED {
            return Ok(Outcome::NotStored(state.status));
        }

        let (user, detail) = match self.read_demo(&message.storage_key).await {
            Ok((facts, bins)) => {
                match sink::write(&self.pool, demo_id, state.version, &facts, &bins).await {
                    Ok(Written::Done(counts)) => return Ok(Outcome::Parsed(counts)),
                    Ok(Written::OutOfDate) => return Ok(Outcome::OutOfDate),
                    Err(e) if sink::is_transient(&e) => return Err(database(e)),
                    Err(e) => (ERROR_INTERNAL, database(e)),
                }
            }
            Err(Failure::Transient(detail)) => return Err(detail),
            Err(Failure::Demo { user, detail }) => (user, detail),
        };

        error!(demo_id, match_id = message.faceit_match_id.as_str(), %detail, "the demo cannot be parsed");
        match sink::mark_failed(&self.pool, demo_id, state.version, user)
            .await
            .map_err(database)?
        {
            true => Ok(Outcome::Failed(user)),
            false => Ok(Outcome::OutOfDate),
        }
    }

    /// Downloads the object `key`, decompresses it and parses the demo. Both temporary files are removed when this
    /// returns, whatever the result, because each is deleted when its handle is dropped.
    async fn read_demo(&self, key: &str) -> Result<(Facts, Vec<HeatBin>), Failure> {
        let temp_file = |what: &str| {
            NamedTempFile::new_in(&self.work_dir).map_err(|e| {
                Failure::Transient(format!("cannot create the temporary file for {what}: {e}"))
            })
        };
        let compressed = temp_file("the download")?;
        let compressed_bytes = self
            .storage
            .download(key, compressed.path(), self.max_demo_bytes)
            .await
            .map_err(|e| match e {
                DownloadError::Missing => Failure::Demo {
                    user: ERROR_MISSING,
                    detail: format!("{key}: {e}"),
                },
                DownloadError::TooLarge => Failure::Demo {
                    user: ERROR_TOO_LARGE,
                    detail: format!("{key}: {e}"),
                },
                DownloadError::Refused(_) => Failure::Demo {
                    user: ERROR_INTERNAL,
                    detail: format!("{key}: {e}"),
                },
                DownloadError::Unavailable(_) | DownloadError::Io(_) => {
                    Failure::Transient(format!("storage: {e}"))
                }
            })?;
        let demo = temp_file("the demo")?;
        let max_demo_bytes = self.max_demo_bytes;

        // Decompressing and parsing keep every core busy for seconds, so they run off the async runtime. The parser
        // may panic on a file that is not what it expects; the panic ends the blocking task and nothing else.
        let work = tokio::task::spawn_blocking(move || {
            let demo_bytes = storage::decompress(compressed.path(), demo.path(), max_demo_bytes)
                .map_err(|e| match e {
                    DecompressError::Corrupt(_) => Failure::Demo {
                        user: ERROR_NOT_A_DEMO,
                        detail: e.to_string(),
                    },
                    DecompressError::TooLarge => Failure::Demo {
                        user: ERROR_TOO_LARGE,
                        detail: e.to_string(),
                    },
                    DecompressError::Io(_) => Failure::Transient(e.to_string()),
                })?;
            // The compressed copy has served its purpose; free its space before the parse.
            drop(compressed);
            debug!(compressed_bytes, demo_bytes, "demo decompressed");
            let facts = parse::parse_demo(demo.path()).map_err(|e| match e {
                ParseError::NotADemo(_) => Failure::Demo {
                    user: ERROR_NOT_A_DEMO,
                    detail: e.to_string(),
                },
                ParseError::Io(_) => Failure::Transient(e.to_string()),
            })?;
            let bins = bins::aggregate(&facts);
            Ok((facts, bins))
        });
        match work.await {
            Ok(result) => result,
            Err(e) if e.is_panic() => Err(Failure::Demo {
                user: ERROR_NOT_A_DEMO,
                detail: format!("the demo parser panicked: {}", panic_text(e.into_panic())),
            }),
            Err(e) => Err(Failure::Transient(format!(
                "the parse task did not finish: {e}"
            ))),
        }
    }
}

async fn close(connection: &Connection) {
    let _ = connection.close(200, "bye".into()).await;
}

/// Creates the directory for the temporary files and empties it: a worker that was killed could not remove its files.
/// Each worker needs a temporary directory of its own, which a container gives it.
fn prepare_work_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_file() {
            match std::fs::remove_file(&path) {
                Ok(()) => info!("removed a temporary file left by an earlier run"),
                Err(e) => warn!("could not remove a temporary file left by an earlier run: {e}"),
            }
        }
    }
    Ok(())
}

/// What a panic said, if it said it in words.
fn panic_text(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        (*text).to_string()
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text.clone()
    } else {
        "no message".to_string()
    }
}
