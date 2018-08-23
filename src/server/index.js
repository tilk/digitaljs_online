const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const yosys2digitaljs = require('yosys2digitaljs');

app.use(bodyParser.json());

app.post('/api/yosys2digitaljs', (req, res) => {
    yosys2digitaljs.process_files(req.body)
    .then(ret => res.json(ret))
    .catch(ret => res.status(500).json({error: 'Yosys failed', messages: ret}));
});

app.listen(8080, 'localhost');

