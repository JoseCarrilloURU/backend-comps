-- Delete all data from the logs table and reset its ID
DELETE FROM logs;
DELETE FROM sqlite_sequence WHERE name = 'logs';

-- Delete all data from the userLogs table and reset its ID
DELETE FROM userLogs;
DELETE FROM sqlite_sequence WHERE name = 'userLogs';