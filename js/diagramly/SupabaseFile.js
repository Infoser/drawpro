/**
 * Supabase Storage Driver for DrawPro
 * Integrates draw.io's file system with Supabase backend
 * 
 * This file should be loaded after draw.io's core files
 */

// SupabaseFile class - extends DrawioFile for Supabase cloud storage
var SupabaseFile = function(ui, data, title, diagramId)
{
    DrawioFile.call(this, ui, data);
    
    this.title = title || 'Untitled Diagram';
    this.diagramId = diagramId;
    this.etag = this.getEtag(data);
    this.autosaveDelay = 1000;
    this.maxAutosaveDelay = 30000;
    this.maxRetries = 5;
    this.type = 'F';
    this.supabaseUrl = ui.supabaseUrl || '';
    this.supabaseAnonKey = ui.supabaseAnonKey || '';
    
    // Auto-save timer
    this.autosaveTimer = null;
    this.pendingSave = false;
};

mxUtils.extend(SupabaseFile, DrawioFile);

SupabaseFile.prototype.getMode = function() {
    return App.MODE_BROWSER;
};

SupabaseFile.prototype.isSyncSupported = function() {
    return true;
};

SupabaseFile.prototype.getPollingInterval = function() {
    return 10000;
};

SupabaseFile.prototype.loadDescriptor = function(success, error) {
    this.getLatestVersionId(success, error);
};

SupabaseFile.prototype.getLatestVersionId = function(success, error) {
    this.getFileContent(mxUtils.bind(this, function(data) {
        success(this.getEtag(data));
    }), error);
};

SupabaseFile.prototype.isAutosaveOptional = function() {
    return true;
};

SupabaseFile.prototype.getHash = function() {
    return 'S' + encodeURIComponent(this.diagramId || this.getTitle());
};

SupabaseFile.prototype.getTitle = function() {
    return this.title;
};

SupabaseFile.prototype.isRenamable = function() {
    return true;
};

SupabaseFile.prototype.getDescriptor = function() {
    return this.etag;
};

SupabaseFile.prototype.setDescriptor = function(etag) {
    this.etag = etag;
};

SupabaseFile.prototype.getDescriptorEtag = function(desc) {
    return desc;
};

// Save file to Supabase
SupabaseFile.prototype.save = function(revision, success, error) {
    DrawioFile.prototype.save.apply(this, [false, mxUtils.bind(this, function() {
        this.saveFile(this.getTitle(), false, success, error);
    }), error]);
};

SupabaseFile.prototype.saveAs = function(title, success, error) {
    this.rename(title, success, error);
};

SupabaseFile.prototype.rename = function(title, success, error) {
    var oldTitle = this.title;
    this.title = title;
    
    this.saveFile(title, true, mxUtils.bind(this, function() {
        this.setTitle(title);
        success(this);
    }), error);
};

SupabaseFile.prototype.setTitle = function(title) {
    this.title = title;
    this.ui.setCurrentFile(this);
};

SupabaseFile.prototype.saveFile = function(title, isRename, success, error) {
    if (this.savingFile) {
        return;
    }
    
    this.savingFile = true;
    this.setShadowModified(false);
    
    var data = this.getData();
    var etag = this.getEtag(data);
    
    // Call API to save
    this.callApi('/api/diagrams/' + this.diagramId + '/versions', 'POST', {
        nodes: this.extractNodes(data),
        edges: this.extractEdges(data),
        viewport: this.getViewport()
    }, mxUtils.bind(this, function(response) {
        this.etag = etag;
        this.savingFile = false;
        this.setDescriptor(etag);
        this.contentChanged();
        this.fileSaved(data, etag, success, error);
    }), mxUtils.bind(this, function(err) {
        this.savingFile = false;
        if (error) error(err);
    }));
};

// Extract nodes from mxGraphModel XML
SupabaseFile.prototype.extractNodes = function(xml) {
    // Parse XML and extract vertex cells
    var nodes = [];
    try {
        var doc = mxUtils.parseXml(xml);
        var root = doc.documentElement;
        var cells = root.getElementsByTagName('mxCell');
        
        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i];
            if (cell.getAttribute('vertex') === '1') {
                var geometry = cell.getElementsByTagName('mxGeometry')[0];
                var x = 0, y = 0, width = 120, height = 60;
                
                if (geometry) {
                    x = parseFloat(geometry.getAttribute('x') || 0);
                    y = parseFloat(geometry.getAttribute('y') || 0);
                    width = parseFloat(geometry.getAttribute('width') || 120);
                    height = parseFloat(geometry.getAttribute('height') || 60);
                }
                
                nodes.push({
                    id: cell.getAttribute('id'),
                    type: this.getNodeType(cell),
                    label: cell.getAttribute('value') || '',
                    position: { x: x, y: y },
                    size: { width: width, height: height },
                    style: cell.getAttribute('style') || ''
                });
            }
        }
    } catch (e) {
        console.warn('Failed to extract nodes:', e);
    }
    return nodes;
};

SupabaseFile.prototype.extractEdges = function(xml) {
    var edges = [];
    try {
        var doc = mxUtils.parseXml(xml);
        var cells = doc.documentElement.getElementsByTagName('mxCell');
        
        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i];
            if (cell.getAttribute('edge') === '1') {
                edges.push({
                    id: cell.getAttribute('id'),
                    source: cell.getAttribute('source'),
                    target: cell.getAttribute('target'),
                    style: cell.getAttribute('style') || '',
                    label: cell.getAttribute('value') || ''
                });
            }
        }
    } catch (e) {
        console.warn('Failed to extract edges:', e);
    }
    return edges;
};

SupabaseFile.prototype.getNodeType = function(cell) {
    var style = cell.getAttribute('style') || '';
    if (style.indexOf('shape=ellipse') >= 0 || style.indexOf('ellipse') >= 0) return 'terminator';
    if (style.indexOf('shape=rhombus') >= 0 || style.indexOf('diamond') >= 0) return 'decision';
    if (style.indexOf('shape=parallelogram') >= 0) return 'input';
    return 'process';
};

SupabaseFile.prototype.getViewport = function() {
    var graph = this.ui.editor.graph;
    if (graph && graph.view) {
        return {
            x: graph.view.translate.x,
            y: graph.view.translate.y,
            zoom: graph.view.scale
        };
    }
    return { x: 0, y: 0, zoom: 1 };
};

// Call API with authentication
SupabaseFile.prototype.callApi = function(url, method, data, success, error) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    
    // Get auth token from Supabase
    var supabase = this.ui.supabaseClient;
    if (supabase) {
        supabase.auth.getSession().then(function(response) {
            if (response.data.session) {
                xhr.setRequestHeader('Authorization', 'Bearer ' + response.data.session.access_token);
                sendRequest();
            } else {
                sendRequest(); // Try without auth
            }
        }).catch(function() {
            sendRequest();
        });
    } else {
        sendRequest();
    }
    
    function sendRequest() {
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        var response = JSON.parse(xhr.responseText);
                        success(response);
                    } catch (e) {
                        success({});
                    }
                } else {
                    if (error) error(xhr.statusText);
                }
            }
        };
        
        xhr.send(data ? JSON.stringify(data) : null);
    }
};

// Static methods for file management
SupabaseFile.listFiles = function(ui, success, error) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/diagrams?filter=all', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    var files = JSON.parse(xhr.responseText);
                    success(files);
                } catch (e) {
                    success([]);
                }
            } else {
                if (error) error();
            }
        }
    };
    xhr.send();
};

SupabaseFile.getFileContent = function(ui, diagramId, success, error) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/diagrams/' + diagramId, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    var diagram = JSON.parse(xhr.responseText);
                    // Convert to mxGraphModel XML
                    var xml = SupabaseFile.convertToMxGraph(diagram);
                    success(xml);
                } catch (e) {
                    success(null);
                }
            } else {
                if (error) error();
            }
        }
    };
    xhr.send();
};

SupabaseFile.getFileInfo = function(ui, diagramId, success, error) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/diagrams/' + diagramId, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    var diagram = JSON.parse(xhr.responseText);
                    success({
                        title: diagram.title,
                        size: diagram.nodes?.length || 0,
                        lastModified: new Date(diagram.updated_at).getTime(),
                        type: 'F'
                    });
                } catch (e) {
                    success(null);
                }
            } else {
                if (error) error();
            }
        }
    };
    xhr.send();
};

SupabaseFile.deleteFile = function(ui, diagramId, success, error) {
    var xhr = new XMLHttpRequest();
    xhr.open('DELETE', '/api/diagrams/' + diagramId, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status >= 200 && xhr.status < 300) {
                if (success) success();
            } else {
                if (error) error();
            }
        }
    };
    xhr.send();
};

// Convert diagram JSON to mxGraphModel XML
SupabaseFile.convertToMxGraph = function(diagram) {
    var xml = '<mxfile host="DrawPro" agent="DrawPro" version="1.0" type="device">\n';
    xml += '  <diagram id="' + diagram.id + '" name="' + mxUtils.htmlEntities(diagram.title) + '">\n';
    xml += '    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">\n';
    xml += '      <root>\n';
    xml += '        <mxCell id="0"/>\n';
    xml += '        <mxCell id="1" parent="0"/>\n';
    
    // Add nodes
    if (diagram.latest_version?.nodes) {
        diagram.latest_version.nodes.forEach(function(node) {
            var style = node.style || SupabaseFile.getDefaultStyle(node.type);
            xml += '        <mxCell id="' + node.id + '" value="' + mxUtils.htmlEntities(node.label) + '" style="' + style + '" vertex="1" parent="1">\n';
            xml += '          <mxGeometry x="' + (node.position?.x || 0) + '" y="' + (node.position?.y || 0) + '" width="' + (node.size?.width || 120) + '" height="' + (node.size?.height || 60) + '" as="geometry"/>\n';
            xml += '        </mxCell>\n';
        });
    }
    
    // Add edges
    if (diagram.latest_version?.edges) {
        diagram.latest_version.edges.forEach(function(edge) {
            var style = edge.style || 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;';
            xml += '        <mxCell id="' + edge.id + '" value="' + mxUtils.htmlEntities(edge.label || '') + '" style="' + style + '" edge="1" parent="1" source="' + edge.source + '" target="' + edge.target + '">\n';
            xml += '          <mxGeometry relative="1" as="geometry"/>\n';
            xml += '        </mxCell>\n';
        });
    }
    
    xml += '      </root>\n';
    xml += '    </mxGraphModel>\n';
    xml += '  </diagram>\n';
    xml += '</mxfile>';
    
    return xml;
};

SupabaseFile.getDefaultStyle = function(type) {
    switch (type) {
        case 'terminator':
            return 'shape=ellipse;whiteSpace=wrap;html=1;fillColor=#1f77b4;fontColor=#ffffff;strokeColor=#1f77b4;';
        case 'decision':
            return 'shape=rhombus;whiteSpace=wrap;html=1;fillColor=#ff7f0e;fontColor=#ffffff;strokeColor=#ff7f0e;';
        case 'input':
            return 'shape=parallelogram;whiteSpace=wrap;html=1;fillColor=#2ca02c;fontColor=#ffffff;strokeColor=#2ca02c;';
        case 'process':
        default:
            return 'shape=rectangle;whiteSpace=wrap;html=1;fillColor=#1f77b4;fontColor=#ffffff;strokeColor=#1f77b4;rounded=1;';
    }
};

// Initialize Supabase client in UI
if (typeof EditorUi !== 'undefined') {
    var originalInit = EditorUi.prototype.init;
    EditorUi.prototype.init = function() {
        originalInit.apply(this, arguments);
        
        // Initialize Supabase client
        if (typeof supabase !== 'undefined') {
            this.supabaseClient = supabase.createClient(
                this.supabaseUrl || '',
                this.supabaseAnonKey || ''
            );
        }
    };
    
    // Override file handling to use Supabase
    var originalCreateFile = EditorUi.prototype.createFile;
    EditorUi.prototype.createFile = function(data, title, temp) {
        var file = originalCreateFile.apply(this, arguments);
        
        // If we have a diagram ID, wrap with SupabaseFile
        if (file && this.currentDiagramId) {
            return new SupabaseFile(this, data, title, this.currentDiagramId);
        }
        return file;
    };
}

// Add to global scope
window.SupabaseFile = SupabaseFile;