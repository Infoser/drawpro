/**
 * Supabase Storage Driver for DrawPro
 * Integrates draw.io's file system with Supabase backend
 *
 * This file is loaded as a static script BEFORE the app.min.js bundle
 * (which is injected dynamically by js/bootstrap.js), so nothing here
 * may reference DrawioFile/EditorUi/App/mxUtils at top level. All class
 * definitions and prototype patches are deferred until the bundle has
 * executed (checked by polling), which happens well before App.main()
 * runs on window load.
 */

(function()
{
	var patched = false;
	
	function getHash(data)
	{
		if (typeof mxUtils !== 'undefined' && mxUtils.getHash != null)
		{
			return mxUtils.getHash(data);
		}
		
		var h = 0, i = 0;
		
		for (i = 0; data != null && i < data.length; i++)
		{
			h = ((h << 5) - h + data.charCodeAt(i)) | 0;
		}
		
		return 'h' + h;
	}
	
	// Storage adapter that reads the session from cookies (the app stores
	// sessions in cookies via @supabase/auth-helpers-nextjs, not localStorage).
	// The cookie holds the legacy array format [access_token, refresh_token,
	// provider_token, provider_refresh_token, factors], possibly chunked as
	// <key>.0, <key>.1, ... when larger than 3180 chars. This adapter converts
	// it into the v2 session object supabase-js expects.
	function createCookieStorage()
	{
		function cookieRegex(name)
		{
			return new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)');
		}
		
		function readAll(name)
		{
			var match = document.cookie.match(cookieRegex(name));
			
			if (match != null)
			{
				try { return decodeURIComponent(match[1]); }
				catch (e) { return match[1]; }
			}
			
			var parts = [];
			var i = 0;
			
			for (;;)
			{
				var chunkMatch = document.cookie.match(cookieRegex(name + '.' + i));
				
				if (chunkMatch == null)
				{
					break;
				}
				
				parts.push(chunkMatch[1]);
				i++;
			}
			
			if (parts.length > 0)
			{
				try { return parts.map(decodeURIComponent).join(''); }
				catch (e) { return parts.join(''); }
			}
			
			return null;
		}
		
		return {
			getItem: function(key)
			{
				var raw = readAll(key);
				
				if (raw == null)
				{
					return null;
				}
				
				try
				{
					var parsed = JSON.parse(raw);
					
					if (Array.isArray(parsed))
					{
						var payload = {};
						
						try
						{
							var part = parsed[0].split('.')[1];
							part = part.replace(/-/g, '+').replace(/_/g, '/');
							payload = JSON.parse(atob(part));
						}
						catch (e) { }
						
						var user = {
							id: payload.sub,
							email: payload.email,
							aud: payload.aud,
							role: payload.role,
							app_metadata: payload.app_metadata || {},
							user_metadata: payload.user_metadata || {}
						};
						
						return JSON.stringify({
							access_token: parsed[0],
							refresh_token: parsed[1],
							provider_token: parsed[2],
							provider_refresh_token: parsed[3],
							token_type: 'bearer',
							expires_in: payload.exp != null ? payload.exp - Math.round(Date.now() / 1000) : 3600,
							expires_at: payload.exp != null ? payload.exp : Math.round(Date.now() / 1000) + 3600,
							user: user
						});
					}
				}
				catch (e) { }
				
				return raw;
			},
			setItem: function() { },
			removeItem: function() { }
		};
	}
	
	function setup()
	{
		if (patched)
		{
			return;
		}
		
		if (typeof window.DrawioFile === 'undefined' ||
			typeof window.mxUtils === 'undefined' ||
			typeof window.EditorUi === 'undefined' ||
			typeof window.App === 'undefined')
		{
			setTimeout(setup, 50);
			return;
		}
		
		patched = true;
		
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
		
		SupabaseFile.prototype.getEtag = function(data)
		{
			return getHash(data);
		};
		
		SupabaseFile.prototype.getMode = function()
		{
			return App.MODE_BROWSER;
		};
		
		SupabaseFile.prototype.isSyncSupported = function()
		{
			// Realtime sync is handled by RealtimeSync (Yjs over Supabase
			// Realtime), so draw.io's own DrawioFileSync polling is disabled.
			// It used to trigger a second getFileContent whose empty response
			// overwrote the freshly loaded diagram with an empty one.
			return false;
		};
		
		SupabaseFile.prototype.getPollingInterval = function()
		{
			return 10000;
		};
		
		SupabaseFile.prototype.loadDescriptor = function(success, error)
		{
			this.getLatestVersionId(success, error);
		};
		
		SupabaseFile.prototype.getLatestVersionId = function(success, error)
		{
			this.getFileContent(mxUtils.bind(this, function(data)
			{
				success(this.getEtag(data));
			}), error);
		};
		
		SupabaseFile.prototype.isAutosaveOptional = function()
		{
			return true;
		};
		
		SupabaseFile.prototype.getHash = function()
		{
			return 'S' + encodeURIComponent(this.diagramId || this.getTitle());
		};
		
		SupabaseFile.prototype.getTitle = function()
		{
			return this.title;
		};
		
		SupabaseFile.prototype.isRenamable = function()
		{
			return true;
		};
		
		SupabaseFile.prototype.getDescriptor = function()
		{
			return this.etag;
		};
		
		SupabaseFile.prototype.setDescriptor = function(etag)
		{
			this.etag = etag;
		};
		
		SupabaseFile.prototype.getDescriptorEtag = function(desc)
		{
			return desc;
		};
		
		// Loads the latest version of this diagram from the API and
		// converts it to mxGraphModel XML
		SupabaseFile.prototype.getFileContent = function(success, error)
		{
			this.callApi('/api/diagrams/' + this.diagramId + '/versions', 'GET', null,
				mxUtils.bind(this, function(versions)
				{
					var version = (versions != null && versions.length > 0) ? versions[0] : null;
					var xml = '';
					
					if (version != null)
					{
						xml = SupabaseFile.convertToMxGraph({
							id: this.diagramId,
							title: this.getTitle(),
							latest_version: version
						});
					}
					else
					{
						xml = (this.ui.emptyDiagramXml != null) ? this.ui.emptyDiagramXml :
							'<mxfile host="DrawPro" agent="DrawPro" version="1.0" type="device"><diagram id="' +
							this.diagramId + '" name="' + mxUtils.htmlEntities(this.getTitle()) +
							'"><mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" ' +
							'connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" ' +
							'pageHeight="1100" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" ' +
							'parent="0"/></root></mxGraphModel></diagram></mxfile>';
					}
					
					success(xml);
				}), error);
		};
		
		// Save file to Supabase
		SupabaseFile.prototype.save = function(revision, success, error, unloading, overwrite, manual)
		{
			DrawioFile.prototype.save.apply(this, [revision, mxUtils.bind(this, function()
			{
				this.saveFile(this.getTitle(), false, success, error, manual);
			}), error, unloading, overwrite, manual]);
		};
		
		SupabaseFile.prototype.saveAs = function(title, success, error)
		{
			this.rename(title, success, error);
		};
		
		SupabaseFile.prototype.rename = function(title, success, error)
		{
			this.callApi('/api/diagrams/' + this.diagramId, 'PUT', {title: title},
				mxUtils.bind(this, function()
				{
					this.title = title;
					success(this);
				}), error);
		};
		
		SupabaseFile.prototype.setTitle = function(title)
		{
			this.title = title;
		};
		
		SupabaseFile.prototype.saveFile = function(title, isRename, success, error, manual)
		{
			if (this.savingFile)
			{
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
			}, mxUtils.bind(this, function(response)
			{
				this.etag = etag;
				this.savingFile = false;
				this.setDescriptor(etag);
				this.contentChanged();
				this.fileSaved(data, etag, success, error);
			}), mxUtils.bind(this, function(err)
			{
				this.savingFile = false;
				if (error)
				{
					error(err);
				}
			}));
		};
		
		// Extract nodes from mxGraphModel XML
		SupabaseFile.prototype.extractNodes = function(xml)
		{
			// Parse XML and extract vertex cells
			var nodes = [];
			try
			{
				var doc = mxUtils.parseXml(xml);
				var root = doc.documentElement;
				var cells = root.getElementsByTagName('mxCell');
				
				for (var i = 0; i < cells.length; i++)
				{
					var cell = cells[i];
					if (cell.getAttribute('vertex') === '1')
					{
						var geometry = cell.getElementsByTagName('mxGeometry')[0];
						var x = 0, y = 0, width = 120, height = 60;
						
						if (geometry)
						{
							x = parseFloat(geometry.getAttribute('x') || 0);
							y = parseFloat(geometry.getAttribute('y') || 0);
							width = parseFloat(geometry.getAttribute('width') || 120);
							height = parseFloat(geometry.getAttribute('height') || 60);
						}
						
						nodes.push({
							id: cell.getAttribute('id'),
							type: this.getNodeType(cell),
							label: cell.getAttribute('value') || '',
							position: {x: x, y: y},
							size: {width: width, height: height},
							style: cell.getAttribute('style') || ''
						});
					}
				}
			}
			catch (e)
			{
				console.warn('Failed to extract nodes:', e);
			}
			return nodes;
		};
		
		SupabaseFile.prototype.extractEdges = function(xml)
		{
			var edges = [];
			try
			{
				var doc = mxUtils.parseXml(xml);
				var cells = doc.documentElement.getElementsByTagName('mxCell');
				
				for (var i = 0; i < cells.length; i++)
				{
					var cell = cells[i];
					if (cell.getAttribute('edge') === '1')
					{
						edges.push({
							id: cell.getAttribute('id'),
							source: cell.getAttribute('source'),
							target: cell.getAttribute('target'),
							style: cell.getAttribute('style') || '',
							label: cell.getAttribute('value') || ''
						});
					}
				}
			}
			catch (e)
			{
				console.warn('Failed to extract edges:', e);
			}
			return edges;
		};
		
		SupabaseFile.prototype.getNodeType = function(cell)
		{
			var style = cell.getAttribute('style') || '';
			if (style.indexOf('shape=ellipse') >= 0 || style.indexOf('ellipse') >= 0) return 'terminator';
			if (style.indexOf('shape=rhombus') >= 0 || style.indexOf('diamond') >= 0) return 'decision';
			if (style.indexOf('shape=parallelogram') >= 0) return 'input';
			return 'process';
		};
		
		SupabaseFile.prototype.getViewport = function()
		{
			var graph = this.ui.editor.graph;
			if (graph && graph.view)
			{
				return {
					x: graph.view.translate.x,
					y: graph.view.translate.y,
					zoom: graph.view.scale
				};
			}
			return {x: 0, y: 0, zoom: 1};
		};
		
		// Call API with authentication
		SupabaseFile.prototype.callApi = function(url, method, data, success, error)
		{
			var xhr = new XMLHttpRequest();
			xhr.open(method, url, true);
			xhr.setRequestHeader('Content-Type', 'application/json');
			
			// Get auth token from Supabase
			var supabase = this.ui.supabaseClient;
			
			if (supabase)
			{
				supabase.auth.getSession().then(function(response)
				{
					if (response.data.session)
					{
						xhr.setRequestHeader('Authorization', 'Bearer ' + response.data.session.access_token);
					}
					sendRequest();
				}).catch(function()
				{
					sendRequest();
				});
			}
			else
			{
				sendRequest();
			}
			
			function sendRequest()
			{
				xhr.onreadystatechange = function()
				{
					if (xhr.readyState === 4)
					{
						if (xhr.status >= 200 && xhr.status < 300)
						{
							try
							{
								success(JSON.parse(xhr.responseText));
							}
							catch (e)
							{
								success({});
							}
						}
						else
						{
							if (error)
							{
								error(xhr.statusText);
							}
						}
					}
				};
				
				xhr.send(data ? JSON.stringify(data) : null);
			}
		};
		
		// Static methods for file management
		SupabaseFile.listFiles = function(ui, success, error)
		{
			var xhr = new XMLHttpRequest();
			xhr.open('GET', '/api/diagrams?filter=all', true);
			xhr.setRequestHeader('Content-Type', 'application/json');
			
			xhr.onreadystatechange = function()
			{
				if (xhr.readyState === 4)
				{
					if (xhr.status >= 200 && xhr.status < 300)
					{
						try
						{
							success(JSON.parse(xhr.responseText));
						}
						catch (e)
						{
							success([]);
						}
					}
					else
					{
						if (error)
						{
							error();
						}
					}
				}
			};
			xhr.send();
		};
		
		SupabaseFile.getFileInfo = function(ui, diagramId, success, error)
		{
			var xhr = new XMLHttpRequest();
			xhr.open('GET', '/api/diagrams/' + diagramId, true);
			xhr.setRequestHeader('Content-Type', 'application/json');
			
			xhr.onreadystatechange = function()
			{
				if (xhr.readyState === 4)
				{
					if (xhr.status >= 200 && xhr.status < 300)
					{
						try
						{
							var diagram = JSON.parse(xhr.responseText);
							success({
								title: diagram.title,
								size: (diagram.latest_version != null && diagram.latest_version.length > 0) ?
									(diagram.latest_version[0].nodes || []).length : 0,
								lastModified: new Date(diagram.updated_at).getTime(),
								type: 'F'
							});
						}
						catch (e)
						{
							success(null);
						}
					}
					else
					{
						if (error)
						{
							error();
						}
					}
				}
			};
			xhr.send();
		};
		
		SupabaseFile.deleteFile = function(ui, diagramId, success, error)
		{
			var xhr = new XMLHttpRequest();
			xhr.open('DELETE', '/api/diagrams/' + diagramId, true);
			xhr.setRequestHeader('Content-Type', 'application/json');
			
			xhr.onreadystatechange = function()
			{
				if (xhr.readyState === 4)
				{
					if (xhr.status >= 200 && xhr.status < 300)
					{
						if (success)
						{
							success();
						}
					}
					else
					{
						if (error)
						{
							error();
						}
					}
				}
			};
			xhr.send();
		};
		
		// Convert diagram JSON to mxGraphModel XML
		SupabaseFile.convertToMxGraph = function(diagram)
		{
			var xml = '<mxfile host="DrawPro" agent="DrawPro" version="1.0" type="device">\n';
			xml += '  <diagram id="' + diagram.id + '" name="' + mxUtils.htmlEntities(diagram.title) + '">\n';
			xml += '    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">\n';
			xml += '      <root>\n';
			xml += '        <mxCell id="0"/>\n';
			xml += '        <mxCell id="1" parent="0"/>\n';
			
			// Add nodes
			if (diagram.latest_version != null && diagram.latest_version.nodes)
			{
				diagram.latest_version.nodes.forEach(function(node)
				{
					var style = node.style || SupabaseFile.getDefaultStyle(node.type);
					xml += '        <mxCell id="' + node.id + '" value="' + mxUtils.htmlEntities(node.label) + '" style="' + style + '" vertex="1" parent="1">\n';
					xml += '          <mxGeometry x="' + (node.position && node.position.x || 0) + '" y="' + (node.position && node.position.y || 0) + '" width="' + (node.size && node.size.width || 120) + '" height="' + (node.size && node.size.height || 60) + '" as="geometry"/>\n';
					xml += '        </mxCell>\n';
				});
			}
			
			// Add edges
			if (diagram.latest_version != null && diagram.latest_version.edges)
			{
				diagram.latest_version.edges.forEach(function(edge)
				{
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
		
		SupabaseFile.getDefaultStyle = function(type)
		{
			switch (type)
			{
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
		
		// Patch EditorUi.init to inject Supabase config and to open an
		// existing diagram when one was requested via ?id=xxx. This runs
		// inside EditorUi.call (the App constructor), so the values are
		// available to every init-time read, and the asynchronous load
		// completes after the UI is fully constructed.
		var originalInit = EditorUi.prototype.init;
		
		EditorUi.prototype.init = function()
		{
			// Debug/extension hook: the App instance is otherwise only kept
			// in a local variable inside App.main
			window.editor = this;
			
			this.supabaseUrl = urlParams['supabaseUrl'] || '';
			this.supabaseAnonKey = urlParams['supabaseAnonKey'] || '';
			this.appUrl = urlParams['appUrl'] || '';
			this.currentDiagramId = urlParams['diagramId'] || urlParams['id'] || null;
			
			// Initialize Supabase client (session lives in cookies)
			if (typeof supabase !== 'undefined')
			{
				this.supabaseClient = supabase.createClient(
					this.supabaseUrl || '',
					this.supabaseAnonKey || '',
					{
						auth: {
							storage: createCookieStorage(),
							persistSession: false,
							autoRefreshToken: true
						}
					}
				);
			}
			
			originalInit.apply(this, arguments);
			
			// Opens an existing diagram from the dashboard
			if (this.currentDiagramId != null && this.currentDiagramId !== '')
			{
				var that = this;
				var file = new SupabaseFile(this, '', 'Untitled Diagram', this.currentDiagramId);
				
				file.getFileContent(mxUtils.bind(this, function(xml)
				{
					// Guard: the load callback can fire more than once (e.g. a
					// second XHR ready-state event with an empty response). The
					// first response is always the valid one.
					if (that._diagramLoaded)
					{
						return;
					}
					
					that._diagramLoaded = true;
					
					file.setData(xml);
					
					// Loads the diagram title (best effort)
					file.callApi('/api/diagrams/' + that.currentDiagramId, 'GET', null,
						function(diagram)
						{
							if (diagram != null && diagram.title != null)
							{
								file.setTitle(diagram.title);
								that.updateDocumentTitle();
							}
						}, function() { });
					
					that.fileLoaded(file);
					
					// Starts Yjs realtime collaboration for this diagram
					if (typeof that.startRealtime === 'function')
					{
						that.startRealtime(file);
					}
				}), mxUtils.bind(this, function(err)
				{
					console.warn('Failed to load diagram ' + that.currentDiagramId + ':', err);
					
					// Shows the default splash screen
					if (urlParams['splash'] != '0')
					{
						that.showSplash();
					}
				}));
			}
		};
		
		// Add to global scope
		window.SupabaseFile = SupabaseFile;
	}
	
	setup();
})();