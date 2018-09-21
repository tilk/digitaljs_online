"use strict";

import 'bootstrap';
import './scss/app.scss';
import 'codemirror/mode/verilog/verilog';
import 'codemirror/lib/codemirror.css';
import CodeMirror from 'codemirror/lib/codemirror';
import $ from 'jquery';
import * as digitaljs from 'digitaljs';
import Split from 'split.js';

const examples = [
    ['sr_gate.sv', 'SR latch'],
    ['sr_neg_gate.sv', 'SR latch (negated inputs)'],
    ['dlatch_gate.sv', 'D latch'],
    ['dff_masterslave.sv', 'D flip-flop (master-slave)'],
    ['fulladder.sv', 'Full adder'],
    ['serialadder.sv', 'Serial adder'],
    ['cycleadder_arst.sv', 'Accumulating adder'],
    ['prio_encoder.sv', 'Priority encoder'],
    ['lfsr.sv', 'Linear-feedback shift register'],
    ['rom.sv', 'ROM'],
    ['ram.sv', 'RAM'],
];

$(window).on('load', () => {

Split(['#editor', '#paper'], {
    sizes: [50, 50],
    minSize: 200
});

const editor = CodeMirror.fromTextArea(document.getElementById("code"), {
    lineNumbers: true,
    mode: {
        name: 'verilog'
    }
});

for (const [file, name] of examples) {
    $('<a class="dropdown-item" href="">').text(name).appendTo($('#excodes')).click((e) => {
        e.preventDefault();
        $.get('/examples/' + file, (data, status) => {
            editor.setValue(data);
        });
    });
}

let loading = false, circuit, paper, filedata, filenum;

function updatebuttons() {
    if (circuit == undefined) {
        $('#toolbar').find('button').prop('disabled', true);
        if (!loading) $('#toolbar').find('button[name=load]').prop('disabled', false);
        return;
    }
    $('#toolbar').find('button[name=load]').prop('disabled', false);
    $('#toolbar').find('button[name=save]').prop('disabled', false);
    $('#toolbar').find('button[name=link]').prop('disabled', false);
    const running = circuit.running;
    $('#toolbar').find('button[name=pause]').prop('disabled', !running);
    $('#toolbar').find('button[name=resume]').prop('disabled', running);
    $('#toolbar').find('button[name=single]').prop('disabled', running);
    $('#toolbar').find('button[name=next]').prop('disabled', running || !circuit.hasPendingEvents);
}

function runquery() {
    const data = {'_input.sv': editor.getValue()};
    for (const [filename, file] of Object.entries(filedata)) {
        data[filename] = file.result;
    }
    if (circuit) {
        circuit.shutdown();
        circuit = undefined;
    }
    if (paper) {
        paper.remove();
        paper = undefined;
    }
    loading = true;
    updatebuttons();
    $.ajax({
        type: 'POST',
        url: '/api/yosys2digitaljs',
        contentType: "application/json",
        data: JSON.stringify(data),
        dataType: 'json',
        success: (responseData, status, xhr) => {
            loading = false;
            $('form').find('input, textarea, button, select').prop('disabled', false);
            circuit = new digitaljs.Circuit(responseData.output);
            circuit.on('userChange', () => {
                updatebuttons();
            });
            circuit.start();
            paper = circuit.displayOn($('<div>').appendTo($('#paper')));
            updatebuttons();
        },
        error: (request, status, error) => {
            $('form').find('input, textarea, button, select').prop('disabled', false);
            $('<div class="alert alert-danger alert-dismissible fade show" role="alert"></div>')
                .append('<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>')
                .append(document.createTextNode(request.responseJSON.error))
                .append($("<pre>").text(request.responseJSON.messages.stderr.trim()))
                .appendTo($('#editor'))
                .alert();
        }
    });
}

$('button[type=submit]').click(e => {
    e.preventDefault();
    $('form').find('input, textarea, button, select').prop('disabled', true);
    filedata = {};
    filenum = document.getElementById('files').files.length;
    for (const file of document.getElementById('files').files) {
        const reader = filedata[file.name] = new FileReader();
        reader.onload = x => {
            if (--filenum == 0) runquery();
        };
        reader.readAsText(file);
    }
    if (filenum == 0) runquery();
});

$('button[name=pause]').click(e => {
    circuit.stop();
    updatebuttons();
});

$('button[name=resume]').click(e => {
    circuit.start();
    updatebuttons();
});

$('button[name=single]').click(e => {
    circuit.updateGates();
    updatebuttons();
});

$('button[name=next]').click(e => {
    while (!circuit.updateGates());
    updatebuttons();
});

updatebuttons();

});

