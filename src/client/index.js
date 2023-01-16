"use strict";

import 'popper.js';
import 'bootstrap';
import Droppable from 'droppable';
import ClipboardJS from 'clipboard';
import './scss/app.scss';
import 'codemirror/mode/verilog/verilog';
import 'codemirror/mode/lua/lua';
import 'codemirror/lib/codemirror.css';
import 'codemirror/addon/lint/lint.css';
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
        track: 1
    }],
    columnMinSize: '100px',
    columnSnapOffset: 0
});

$('#editor-tab > nav').on('click', 'a', function (e) {
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

function download_tab (tab_a, filename, extension)
{
    var tabContentId = $(tab_a).attr("href");
    const name = tabContentId.substring(1);
    const blob = new Blob([editors[name].getValue()], {type: "text/plain;charset=utf-8"});
    saveAs(blob, filename + "." + extension);
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

function find_filename(name) {
    const list = $('#editor-tab > .tab-content > .tab-pane').filter((_, el) => $(el).data('fullname') == name);
    if (list.length == 0) return;
    return list[0].id;
}

function make_tab(filename, extension, content) {
    const orig_filename = filename;
    let fcnt = 0;
    while ($('#editor-tab > .tab-content > .tab-pane')
            .filter((_, el) => $(el).data('filename') == filename && $(el).data('extension') == extension).length) {
        filename = orig_filename + fcnt++;
    }
    const name = "file" + cnt++;
    const tab = $('<a class="nav-item nav-link" role="tab" data-toggle="tab" aria-selected="false">')
        .attr('href', '#' + name)
        .attr('aria-controls', name)
        .text(filename + '.' + extension)
        .appendTo($('#editor-tab > nav div'));
    $('<button class="close closeTab" type="button">×</button>')
        .on('click', function (e) { close_tab(tab); })
        .appendTo(tab);
    $('<button class="close closeTab" type="button">📥</button>')
        .on('click', function (e) { download_tab(tab, filename, extension); })
        .appendTo(tab);
    const panel = $('<div role="tabpanel" class="tab-pane">')
        .attr('id', name)
        .attr('data-filename', filename)
        .attr('data-extension', extension)
        .attr('data-fullname', filename + '.' + extension)
        .appendTo($('#editor-tab > .tab-content'));
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
        },
        gutters: ['CodeMirror-lint-markers']
    });
    editor._is_dirty = false;
    editor.on('changes', () => { editor._is_dirty = true; });
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

const droppable = new Droppable({
    element: document.querySelector('#dropzone')
});

droppable.onFilesDropped((files) => {
    for (const file of files) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const file_parts = file.name.split(".");
            const filename = file_parts.slice(0, -1).join(".");
            const extension = file_parts.slice(-1)[0];
            make_tab(filename, extension, reader.result);
        };
        reader.readAsText(file);
    }
});

let loading = false, circuit, paper, monitor, monitorview, monitormem, iopanel, filedata, filenum;

function updatebuttons() {
    if (circuit == undefined) {
        $('.upper-toolbar-group').find('button').prop('disabled', true);
        $('button.circuit-tab').prop('disabled', true);
        $('.zoom-buttons-wrapper').addClass('d-none');
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
    $('#toolbar').find('button[name=fastfw]').prop('disabled', running);
    monitorview.autoredraw = !running;
    $('button.circuit-tab').prop('disabled', false);
    $('.zoom-buttons-wrapper').removeClass('d-none');
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
    $('#editor-tab > .tab-content > div[data-extension=lua] button').prop('disabled', true);
    helpers = {};
    loading = true;
    updatebuttons();
    $('#monitorbox button').prop('disabled', true).off();
}

function mk_markers(paper) {
    let markers = [];
    paper.on('cell:mouseover', (cellView) => {
        for (const marker of markers) marker.clear();
        markers = [];
        const positions = cellView.model.get('source_positions');
        if (!positions) return;
        for (const pos of positions) {
            const editor = editors[find_filename(pos.name)];
            if (!editor || editor._is_dirty) continue;
            const marker = editor.markText({line: pos.from.line-1, ch: pos.from.column-1},
                                           {line: pos.to.line-1, ch: pos.to.column-1},
                                           {css: 'background-color: yellow'});
            markers.push(marker);
        }
    });
    paper.on('cell:mouseout', (cellView) => {
        for (const marker of markers) marker.clear();
    });
}

function mkcircuit(data, opts) {
    loading = false;
    $('form').find('input, textarea, button, select').prop('disabled', false);
    circuit = new digitaljs.Circuit(data, opts);
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
    mk_markers(paper);
    circuit.on('new:paper', (paper) => { mk_markers(paper); });
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
    $('#editor-tab > .tab-content > div[data-extension=lua] button[name=luarun]').prop('disabled', false);
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
        if ($('#monitorbox').height() == 0) {
            $('.grid').addClass('monitor-open');
        }
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

    let paperScale = 0;
    $('button[name=zoom-in]').click(e => {
        paperScale++;
        circuit.scaleAndRefreshPaper(paper, paperScale);
     });

    $('button[name=zoom-out]').click(e => {
        paperScale--;
        circuit.scaleAndRefreshPaper(paper, paperScale);
    });

    paper.on('scale', (currentScale) => {
       $('button[name=zoom-in]').prop('disabled', currentScale >= 5);
    });
}

function makeLintMarker(cm, labels, severity, multiple) {
    let marker = document.createElement("div"), inner = marker;
    marker.className = "CodeMirror-lint-marker CodeMirror-lint-marker-" + severity;
    if (multiple) {
        inner = marker.appendChild(document.createElement("div"));
        inner.className = "CodeMirror-lint-marker CodeMirror-lint-marker-multiple";
    }
    let text = labels.join("\n");
    $(inner).tooltip({
        title: text
    });

    return marker;
}

function updateLint(lint) {
    for (const [name, editor] of Object.entries(editors)) {
        editor.clearGutter('CodeMirror-lint-markers');
    }
    if (!lint || lint.length == 0) return;
    const data = {};
    for (const lintInfo of lint) {
        if (!(lintInfo.file in data))
            data[lintInfo.file] = {};
        if (!(lintInfo.line in data[lintInfo.file]))
            data[lintInfo.file][lintInfo.line] = {messages: [], maxSeverity: lintInfo.type.toLowerCase()};
        data[lintInfo.file][lintInfo.line].messages.push(lintInfo.message);
        if (lintInfo.type == "Error")
            data[lintInfo.file][lintInfo.line].maxSeverity = lintInfo.type.toLowerCase();
    }
    for (const [name, lines] of Object.entries(data)) {
        const editor = editors[find_filename(name)];
        if (!editor) continue;
        for (const [line, {messages, maxSeverity}] of Object.entries(lines)) {
            editor.setGutterMarker(Number(line-1), 'CodeMirror-lint-markers',
                makeLintMarker(editor, messages, maxSeverity, messages.length > 1));
        }
    }
}

function runquery() {
    const data = {};
    for (const [name, editor] of Object.entries(editors)) {
        const panel = $('#'+name);
        data[panel.data("filename") + "." + panel.data("extension")] = editor.getValue();
        editor._is_dirty = false;
    }
    for (const [filename, file] of Object.entries(filedata)) {
        data[filename] = file.result;
    }
    if (Object.keys(data).length == 0) {
        $('<div class="query-alert alert alert-danger alert-dismissible fade show" role="alert"></div>')
            .append('<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>')
            .append(document.createTextNode("No source files for synthesis."))
            .appendTo($('#toolbar'))
            .alert();
        return;
    }
    const opts = {
        optimize: $('#opt').prop('checked'),
        fsm: $('#fsm').val(),
        fsmexpand: $('#fsmexpand').prop('checked'),
        lint: $('#lint').prop('checked')
    };
    const transform = $('#transform').prop('checked');
    const layoutEngine = $('#layout').val();
    const simEngine = $('#engine').val();
    destroycircuit();
    $.ajax({
        type: 'POST',
        url: '/api/yosys2digitaljs',
        contentType: "application/json",
        data: JSON.stringify({ files: data, options: opts }),
        dataType: 'json',
        success: (responseData, status, xhr) => {
            let circuit = responseData.output;
            if (transform) circuit = digitaljs.transform.transformCircuit(circuit);
            const engines = { synch: digitaljs.engines.BrowserSynchEngine, worker: digitaljs.engines.WorkerEngine };
            mkcircuit(circuit, {layoutEngine: layoutEngine, engine: engines[simEngine]});
            updateLint(responseData.lint);
        },
        error: (request, status, error) => {
            loading = false;
            updatebuttons();
            $('form').find('input, textarea, button, select').prop('disabled', false);
            $('<div class="query-alert alert alert-danger alert-dismissible fade show" role="alert"></div>')
                .append('<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>')
                .append(document.createTextNode(request.responseJSON.error))
                .append($("<pre>").text(request.responseJSON.yosys_stderr.trim()))
                .appendTo($('#toolbar'))
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

    openTab(circuitTabClass);
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

$('[data-bs-toggle="tooltip"]').tooltip();

});


function openTab(tabClass) {
    $('.tab-wrapper').removeClass('active');
    $('.tab-btn').removeClass('active');
    $(`.${tabClass}`).addClass('active');
}

const editorTabClass = 'editor-tab';
const circuitTabClass = 'circuit-tab';

$(`button.${editorTabClass}`).click(() => openTab(editorTabClass));
$(`button.${circuitTabClass}`).click(() => openTab(circuitTabClass));
