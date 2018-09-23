-- Up
CREATE TABLE storedCircuits(
    hash        TEXT    PRIMARY KEY,
    json        TEXT    NOT NULL,
    date        TEXT    NOT NULL,
    lastAccess  TEXT    NOT NULL
);

-- Down
DROP TABLE storedCircuits;
