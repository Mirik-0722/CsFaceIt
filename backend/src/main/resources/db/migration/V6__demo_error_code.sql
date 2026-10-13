-- A reason a page can translate: demos.error stays the English sentence for the logs and for any client that shows it as
-- it is, error_code is a short upper-case code for the reasons the site explains in its own words. NULL while there is no
-- such reason, which is the case for every failure but the codes of DemoErrorCode (today only DOWNLOAD_NEEDS_ACCESS: FACEIT
-- did not let this site download the demo). It is set only together with error on a FAILED demo and cleared whenever error is.
ALTER TABLE demos ADD COLUMN error_code VARCHAR(32);
