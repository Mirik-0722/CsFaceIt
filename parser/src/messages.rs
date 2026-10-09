//! The RabbitMQ names and message bodies the worker shares with the backend (`DemoMessages.java` there). Bodies are
//! JSON with camelCase fields. The backend declares the exchange and the queues; the worker only uses them.

use serde::{Deserialize, Serialize};

/// Topic exchange; the routing key of a message is the name of the queue it is meant for.
pub const EXCHANGE: &str = "demo";

/// Stored demos waiting for this worker.
pub const PARSE_QUEUE: &str = "demo.parse";

/// Routing key (and queue) of the demos this worker has parsed.
pub const PARSED_ROUTING_KEY: &str = "demo.parsed";

/// `demo.parse`: the file of a demo is in storage. Fields the worker does not know are ignored.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoStored {
    pub demo_id: i64,
    pub faceit_match_id: String,
    pub storage_key: String,
}

/// `demo.parsed`: the facts of a demo are in the database.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoParsed<'a> {
    pub demo_id: i64,
    pub faceit_match_id: &'a str,
}

impl DemoStored {
    /// Reads a `demo.parse` body. The error says what is wrong with it and is meant for the log.
    pub fn from_json(body: &[u8]) -> Result<Self, String> {
        let message: DemoStored = serde_json::from_slice(body).map_err(|e| e.to_string())?;
        if message.demo_id <= 0 {
            return Err("demoId is not a positive number".to_string());
        }
        if message.faceit_match_id.trim().is_empty() {
            return Err("faceitMatchId is empty".to_string());
        }
        if message.storage_key.trim().is_empty() {
            return Err("storageKey is empty".to_string());
        }
        Ok(message)
    }
}

impl DemoParsed<'_> {
    pub fn to_json(&self) -> Vec<u8> {
        // A struct of a number and a string always serializes.
        serde_json::to_vec(self).expect("a demo.parsed message serializes to JSON")
    }
}
