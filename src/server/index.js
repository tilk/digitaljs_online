import express from 'express';
import body_parser from 'body-parser';
const app = express();
import { process_files } from 'yosys2digitaljs/node';
import { io_ui } from 'yosys2digitaljs/core';
import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import SQL from 'sql-template-strings';
import sha256 from 'js-sha256';

Promise.resolve((async () => {
    const db = await sqlite.open({filename: './database.sqlite', driver: sqlite3.Database});
    await db.migrate(); // ({ force: 'last' });

    app.use(body_parser.json({limit: '50mb'}));

    app.post('/api/yosys2digitaljs', async (req, res) => {
        try {
            const data = await process_files(req.body.files, req.body.options);
            io_ui(data.output);
            return res.json(data);
        } catch(ret) {
            return res.status(500).json({
                error: ret.message,
                yosys_stdout: ret.yosys_stdout,
                yosys_stderr: ret.yosys_stderr
            });
        }
    });

    app.post('/api/storeCircuit', async (req, res) => {
        try {
            // TODO verify if we got a JSON circuit
            const data = req.body;
            const sdata = JSON.stringify(data);
            const hash = sha256(sdata);
            const stmt = await db.run(SQL`UPDATE storedCircuits SET lastAccess=datetime('now') WHERE hash=${hash}`);
            if (stmt.changes == 0) {
                await db.run(SQL`INSERT INTO storedCircuits(hash, json, date, lastAccess) VALUES(${hash}, ${sdata}, datetime('now'), datetime('now'))`);
            }
//          await db.exec('INSERT INTO storedCircuits(hash, json, date, lastAccess) VALUES(?, ?, datetime("now"), datetime("now"))', hash, sdata);
            return res.json(hash);
        } catch(ret) {
            return res.status(500).json({error: 'Store failed', messages: String(ret)});
        }
    });
    
    app.get('/api/circuit/:hash', async (req, res) => {
        try {
            const data = await db.get(SQL`SELECT json FROM storedCircuits WHERE hash=${req.params.hash}`);
            if (data === undefined)
                return res.status(404).json({error: 'Circuit not found'});
            return res.json(JSON.parse(data.json));
        } catch(ret) {
            return res.status(500).json({error: 'Store failed', messages: String(ret)});
        }
    });

    app.listen(8080, 'localhost');
})());


