"use strict";

import 'popper.js';
import 'bootstrap';
import ClipboardJS from 'clipboard';
import './scss/app.scss';
import 'codemirror/mode/verilog/verilog';
import 'codemirror/mode/lua/lua';
import 'codemirror/lib/codemirror.css';
import 'bootstrap/js/src/tab.js';
import CodeMirror from 'codemirror/lib/codemirror';
import $ from 'jquery';
import * as digitaljs from 'digitaljs';
import * as digitaljs_lua from 'digitaljs_lua';
import Split from 'split-grid';
import { saveAs } from 'file-saver';

const examples = [
    ['sr_gate', 'SR latch'],
    ['sr_neg_gate', 'SR latch (negated inputs)'],
    ['dlatch_gate', 'D latch'],
    ['dff_masterslave', 'D flip-flop (master-slave)'],
    ['fulladder', 'Full adder'],
    ['serialadder', 'Serial adder'],
    ['cycleadder_arst', 'Accumulating adder'],
    ['prio_encoder', 'Priority encoder'],
    ['lfsr', 'Linear-feedback shift register'],
    ['fsm', 'Finite state machine'],
    ['rom', 'ROM'],
    ['ram', 'RAM'],
];

$(window).on('load', () => {

Split({
    columnGutters: [{
        element: document.querySelector('#gutter_horiz'),
        track: 1
    }],
    rowGutters: [{
        element: document.querySelector('#gutter_vert'),
        track: 2
    }],
    columnMinSize: '100px',
    columnSnapOffset: 0
});

$('#editor > nav').on('click', 'a', function (e) {
    e.preventDefault();
    $(this).tab('show');
});

let cnt = 0;
let editors = {}, helpers = {};

function handle_luaerror(name, e) {
    $('<div class="query-alert alert alert-danger alert-dismissible fade show" role="alert"></div>')
        .append('<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>')
        .append($("<pre>").text(e.luaMessage))
        .appendTo($('#' + name).find("> div:last-child > div:last-child"))
        .alert();
}

function make_luarunner(name, circuit) {
    helpers[name] = new digitaljs_lua.LuaRunner(circuit); 
    helpers[name].on('thread:stop', (pid) => {
        const panel = $('#' + name);
        panel.find('textarea').prop('disabled', false);
        panel.find('button[name=luarun]').prop('disabled', false);
        panel.find('button[name=luastop]').prop('disabled', true);
    });
    helpers[name].on('thread:error', (pid, e) => {
        handle_luaerror(name, e);
    });
    helpers[name].on('print', msgs => {
        $('<div class="query-alert alert alert-info alert-dismissible fade show" role="alert"></div>')
            .append('<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>')
            .append($("<pre>").text(msgs.join('\t')))
            .appendTo($('#' + name).find('> div:last-child > div:last-child'))
            .alert();
    });
}

function close_tab (tab_a)
{
    var tabContentId = $(tab_a).attr("href");
    var li_list = $(tab_a).parent();
    $(tab_a).remove(); //remove li of tab
    if ($(tabContentId).is(":visible")) {
        li_list.find("a").eq(0).tab('show'); // Select first tab
    }
    $(tabContentId).remove(); //remove respective tab content
    const name = tabContentId.substring(1);
    delete editors[name];
    if (helpers[name]) helpers[name].shutdown();
    delete helpers[name];
}

function make_tab(filename, extension, content) {
    const orig_filename = filename;
    let fcnt = 0;
    while ($('#editor > .tab-content > .tab-pane')
            .filter((_, el) => $(el).data('filename') == filename && $(el).data('extension') == extension).length) {
        filename = orig_filename + fcnt++;
    }
    const name = "file" + cnt++;
    const tab = $('<a class="nav-item nav-link" role="tab" data-toggle="tab" aria-selected="false">')
        .attr('href', '#' + name)
        .attr('aria-controls', name)
        .text(filename + '.' + extension)
        .appendTo($('#editor > nav div'));
    $('<button class="close closeTab" type="button">×</button>')
        .on('click', function (e) { close_tab(tab); })
        .appendTo(tab);
    const panel = $('<div role="tabpanel" class="tab-pane">')
        .attr('id', name)
        .attr('data-filename', filename)
        .attr('data-extension', extension)
        .appendTo($('#editor > .tab-content'));
    const ed_div = $('<textarea>').val(content).appendTo(panel);
    $(tab).tab('show');
    // Lua scripting support
    if (extension == 'lua') {
        const panel2 = $('<div>')
            .appendTo(panel);
        ed_div.appendTo(panel2);
        $('<div class="tab-padded"></div>').appendTo(panel2);
        panel.addClass("tab-withbar");
        // TODO: bar always on top of the tab
        const bar = $(`
            <div class="btn-toolbar" role="toolbar">
             <div class="btn-group" role="group">
              <button name="luarun" type="button" class="btn btn-secondary" disabled>Run</button>
              <button name="luastop" type="button" class="btn btn-secondary" disabled>Stop</button>
             </div>
             <a class="nav-link" href="https://tilk.github.io/digitaljs_lua/USAGE" target="_blank">API reference</a>
            </div>`)
            .prependTo(panel);
        if (circuit) {
            bar.find('button[name=luarun]').prop('disabled', false);
            make_luarunner(name, circuit);
        }
        bar.find('button[name=luarun]').on('click', () => {
            panel.find(".query-alert").removeClass('fade').alert('close');
            let pid;
            try {
                pid = helpers[name].runThread(editors[name].getValue());
            } catch (e) {
                if (e instanceof digitaljs_lua.LuaError)
                    handle_luaerror(name, e);
                else throw e;
            }
            if (pid !== undefined) {
                bar.data('pid', pid);
                panel.find('textarea').prop('disabled', true);
                bar.find('button[name=luarun]').prop('disabled', true);
                bar.find('button[name=luastop]').prop('disabled', false);
            }
        });
        bar.find('button[name=luastop]').on('click', () => {
            const pid = bar.data('pid');
            if (helpers[name].isThreadRunning(pid))
                helpers[name].stopThread(pid);
        });
    }
    const editor = CodeMirror.fromTextArea(ed_div[0], {
        lineNumbers: true,
        mode: {
            name: extension == 'v' || extension == 'sv' ? 'verilog' : 
                  extension == 'lua' ? 'lua' : 'text'
        }
    });
    editors[name] = editor;
}

$('#newtab').on('click', function (e) {
    let filename = $('#start input[name=newtabname]').val() || 'unnamed';
    const extension = $("#exten").data("extension");
    let initial = "";
    if (extension == "v" || extension == "sv")
        initial = "// Write your modules here!\nmodule circuit();\nendmodule";
    make_tab(filename, extension, initial);
});

for (const [file, name] of examples) {
    $('<a class="dropdown-item" href="">').text(name).appendTo($('#excodes')).click((e) => {
        e.preventDefault();
        $.get('/examples/' + file + '.sv', (data, status) => {
            make_tab(file, 'sv', data);
        });
    });
}

$('#exten').parent().on('click', 'a', function (e) {
    const ext = $(this).data('extension');
    $('#exten')
        .text("." + ext)
        .data("extension", ext);
});

let loading = false, circuit, paper, monitor, monitorview, monitormem, iopanel, filedata, filenum;

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
    $('#toolbar').find('button[name=fastfw]').prop('disabled', running || !circuit.hasPendingEvents);
    monitorview.autoredraw = !running;
}

function destroycircuit() {
    if (monitor) {
        // remember which signals were monitored
        monitormem = monitor.getWiresDesc();
    }
    if (circuit) {
        circuit.shutdown();
        circuit = undefined;
    }
    if (paper) {
        paper.remove();
        paper = undefined;
    }
    if (monitorview) {
        monitorview.shutdown();
        monitorview = undefined;
    }
    if (monitor) {
        monitor.stopListening();
        monitor = undefined;
    }
    if (iopanel) {
        iopanel.shutdown();
        iopanel = undefined;
    }
    for (const h of Object.values(helpers)) {
        h.shutdown();
    }
    $('#editor > .tab-content > div[data-extension=lua] button').prop('disabled', true);
    helpers = {};
    loading = true;
    updatebuttons();
    $('#monitorbox button').prop('disabled', true).off();
}

function mkcircuit(data) {
    loading = false;
    $('form').find('input, textarea, button, select').prop('disabled', false);
    circuit = new digitaljs.Circuit(data);
    circuit.on('postUpdateGates', (tick) => {
        $('#tick').val(tick);
    });
    circuit.start();
    monitor = new digitaljs.Monitor(circuit);
    if (monitormem) {
        monitor.loadWiresDesc(monitormem);
        monitormem = undefined;
    }
    monitorview = new digitaljs.MonitorView({model: monitor, el: $('#monitor') });
    iopanel = new digitaljs.IOPanelView({
        model: circuit, el: $('#iopanel'),
        rowMarkup: '<div class="form-group row"></div>',
        labelMarkup: '<label class="col-sm-4 control-label"></label>',
        colMarkup: '<div class="col-sm-8 form-inline"></div>',
        buttonMarkup: '<div class="form-check"><input type="checkbox"></input></div>',
        lampMarkup: '<div class="form-check"><input type="checkbox"></input></div>',
        inputMarkup: '<input type="text" class="mr-2">'
    });
    paper = circuit.displayOn($('<div>').appendTo($('#paper')));
    for (const name of Object.keys(editors)) {
        if ($('#' + name).data('extension') == 'lua') 
            make_luarunner(name, circuit);
    }
    circuit.on('userChange', () => {
        updatebuttons();
    });
    circuit.on('changeRunning', () => {
        updatebuttons();
    });
    updatebuttons();
    $('#editor > .tab-content > div[data-extension=lua] button[name=luarun]').prop('disabled', false);
    $('#monitorbox button').prop('disabled', false);
    $('#monitorbox button[name=ppt_up]').on('click', (e) => { monitorview.pixelsPerTick *= 2; });
    $('#monitorbox button[name=ppt_down]').on('click', (e) => { monitorview.pixelsPerTick /= 2; });
    $('#monitorbox button[name=left]').on('click', (e) => { 
        monitorview.live = false; monitorview.start -= monitorview.width / monitorview.pixelsPerTick / 4;
    });
    $('#monitorbox button[name=right]').on('click', (e) => { 
        monitorview.live = false; monitorview.start += monitorview.width / monitorview.pixelsPerTick / 4;
    });
    $('#monitorbox button[name=live]')
        .toggleClass('active', monitorview.live)
        .on('click', (e) => { 
            monitorview.live = !monitorview.live;
            if (monitorview.live) monitorview.start = circuit.tick - monitorview.width / monitorview.pixelsPerTick;
        });
    monitorview.on('change:live', (live) => { $('#monitorbox button[name=live]').toggleClass('active', live) });
    monitor.on('add', () => {
        if ($('#monitorbox').height() == 0)
            $('html > body > div').css('grid-template-rows', (idx, old) => {
                const z = old.split(' ');
                z[1] = '3fr';
                z[3] = '1fr';
                return z.join(' ');
            });
    });
    const show_range = () => {
        $('#monitorbox input[name=rangel]').val(Math.round(monitorview.start));
        $('#monitorbox input[name=rangeh]').val(Math.round(monitorview.start + monitorview.width / monitorview.pixelsPerTick));
    };
    const show_scale = () => {
        $('#monitorbox input[name=scale]').val(monitorview.gridStep);
    };
    show_range();
    show_scale();
    monitorview.on('change:start', show_range);
    monitorview.on('change:pixelsPerTick', show_scale);
}

function runquery() {
    const data = {};
    for (const [name, editor] of Object.entries(editors)) {
        const panel = $('#'+name);
        data[panel.data("filename") + "." + panel.data("extension")] = editor.getValue();
    }
    for (const [filename, file] of Object.entries(filedata)) {
        data[filename] = file.result;
    }
    if (Object.keys(data).length == 0) {
        $('<div class="query-alert alert alert-danger alert-dismissible fade show" role="alert"></div>')
            .append('<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>')
            .append(document.createTextNode("No source files for synthesis."))
            .prependTo($('#synthesize-bar'))
            .alert();
        return;
    }
    const opts = { optimize: $('#opt').prop('checked'), fsm: $('#fsm').val(), fsmexpand: $('#fsmexpand').prop('checked') };
    destroycircuit();
    $.ajax({
        type: 'POST',
        url: '/api/yosys2digitaljs',
        contentType: "application/json",
        data: JSON.stringify({ files: data, options: opts }),
        dataType: 'json',
        success: (responseData, status, xhr) => {
            mkcircuit(responseData.output);
        },
        error: (request, status, error) => {
            loading = false;
            updatebuttons();
            $('form').find('input, textarea, button, select').prop('disabled', false);
            $('<div class="query-alert alert alert-danger alert-dismissible fade show" role="alert"></div>')
                .append('<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>')
                .append(document.createTextNode(request.responseJSON.error))
                .append($("<pre>").text(request.responseJSON.yosys_stderr.trim()))
                .prependTo($('#synthesize-bar'))
                .alert();
        }
    });
}

$('button[type=submit]').click(e => {
    e.preventDefault();
    $('#synthesize-bar .query-alert').removeClass('fade').alert('close');
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
});

$('button[name=resume]').click(e => {
    circuit.start();
});

$('button[name=single]').click(e => {
    circuit.updateGates();
    updatebuttons();
});

$('button[name=next]').click(e => {
    circuit.updateGatesNext();
    updatebuttons();
});

$('button[name=fastfw]').click(e => {
    circuit.startFast();
    updatebuttons();
});

$('button[name=load]').click(e => {
    $('#input_load').trigger('click');
});

$('#input_load').change(e => {
    const files = e.target.files;
    if (!files) return;
    const reader = new FileReader();
    destroycircuit();
    reader.onload = (e) => {
        mkcircuit(JSON.parse(e.target.result));
    };
    reader.readAsText(files[0]);
});

$('button[name=save]').click(e => {
    const json = circuit.toJSON();
    const blob = new Blob([JSON.stringify(json)], {type: "application/json;charset=utf-8"});
    saveAs(blob, 'circuit.json');
});

$('button[name=link]')
    .popover({
        container: 'body',
        content: 'blah',
        trigger: 'manual',
        html: true
    })
    .popover('disable')
    .click(e => {
        const json = circuit.toJSON();
        $.ajax({
            type: 'POST',
            url: '/api/storeCircuit',
            contentType: "application/json",
            data: JSON.stringify(json),
            dataType: 'json',
            success: (responseData, status, xhr) => {
                history.replaceState(null, null, '#'+responseData);
                $(e.target)
                    .attr('data-content', '<div class="btn-toolbar"><div class="input-group mr-2"><input readonly="readonly" id="linkinput" type="text" value="' + window.location.href + '"></div><div class="btn-group mr-2"><button type="button" data-clipboard-target="#linkinput" class="btn clipboard btn-secondary">Copy link</button></div></div>')
                    .popover('enable')
                    .popover('show');
            }
        });
    })
    .on("hidden.bs.popover", function() { $(this).popover('disable') });

$('html').click(e => {
    if (!$(e.target).closest('button[name=link]').length &&
        !$(e.target).closest('.popover').length)
        $('button[name=link]').popover('hide');
});

window.onpopstate = () => {
    const hash = window.location.hash.slice(1);
    if (loading || !hash) return;
    destroycircuit();
    $.ajax({
        type: 'GET',
        url: '/api/circuit/' + hash,
        dataType: 'json',
        success: (responseData, status, xhr) => {
            mkcircuit(responseData);
        },
        error: (request, status, error) => {
            loading = false;
            updatebuttons();
        }
    });
};

updatebuttons();
$('#monitorbox button').prop('disabled', true).off();

if (window.location.hash.slice(1))
    window.onpopstate();

new ClipboardJS('button.clipboard');

});

