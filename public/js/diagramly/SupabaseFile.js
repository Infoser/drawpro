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
			this.autosaveDelay = 3000;
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
			
			// Get auth token from the session cookie (synchronously). The
			// async getSession() path used to hang on the auth cross-tab
			// lock while the wrapper's own supabase client is initializing,
			// which left every API call in limbo (realtime never started).
			var supabase = this.ui.supabaseClient;
			
			if (supabase != null)
			{
				try
				{
					var stored = supabase.auth.storage.getItem(supabase.auth.storageKey);
					
					if (stored != null)
					{
						var parsed = JSON.parse(stored);
						
						if (parsed != null && parsed.access_token != null)
						{
							xhr.setRequestHeader('Authorization', 'Bearer ' + parsed.access_token);
						}
					}
				}
				catch (e) { }
			}
			
			sendRequest();
			
			function sendRequest()
			{
				// Guard: the auth getSession() promise can settle more than
				// once in rare races, which used to send the same XHR twice
				// (the second fire delivered an empty response and reset the
				// freshly loaded diagram to an empty one).
				if (xhr.__sent)
				{
					return;
				}
				
				xhr.__sent = true;
				
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
			
			// The hash (#Sc0c3...) belongs to draw.io's own file loading and
			// would trigger a deprecated-#S alert plus a spurious default
			// file at startup. This app loads via ?id=, so drop the hash
			// before App.main's loadFile logic runs.
			if (window.location.hash != null && window.location.hash.length > 0)
			{
				window.history.replaceState(null, '', window.location.pathname + window.location.search);
			}
			
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
							// persistSession MUST be true: with false, supabase-js
							// swaps in an in-memory storage and never reads the
							// cookie adapter, so getSession() stays null and
							// realtime auth is impossible. Our adapter is
							// read-only (cookies are written by the app), which
							// is all we need for recovery.
							persistSession: true,
							autoRefreshToken: true
						}
					}
				);
				
				// Recover the session into memory right away. supabase-js does
				// not read the storage adapter when persistSession is false,
				// which left getSession() null in the iframe. The cookie
				// adapter already converts the legacy cookie array into a v2
				// session object, so we hand it straight to setSession.
				var storedSession = null;
				
				try
				{
					storedSession = this.supabaseClient.auth.storage.getItem(this.supabaseClient.auth.storageKey);
				}
				catch (e) { }
				
				if (storedSession != null)
				{
					try
					{
						this.supabaseClient.auth.setSession(JSON.parse(storedSession)).catch(function() { });
					}
					catch (e) { }
				}
			}
			
			originalInit.apply(this, arguments);
			
			// AI diagram generation via NVIDIA NIM. Registers the action,
			// dialog and Extras-menu entry; the API call is same-origin so
			// the session cookie authenticates it automatically.
			if (typeof mxResources !== 'undefined')
			{
				mxResources.parse('aiGenerate=Generate Diagram with AI...');
			}
			
			var that = this;
			
			this.actions.addAction('aiGenerate', mxUtils.bind(this, function()
			{
				if (this.currentDiagramId == null)
				{
					this.handleError(new Error(mxResources.get('noDiagram')));
					return;
				}
				
				var div = document.createElement('div');
				div.className = 'geDialog';
				
				var desc = document.createElement('p');
				desc.style.fontSize = '12px';
				mxUtils.write(desc, 'Describe the diagram you want to generate.');
				div.appendChild(desc);
				
				var textarea = document.createElement('textarea');
				textarea.style.width = '100%';
				textarea.style.height = '90px';
				textarea.style.boxSizing = 'border-box';
				textarea.style.fontFamily = 'inherit';
				textarea.style.fontSize = '12px';
				textarea.style.resize = 'none';
				textarea.placeholder = 'e.g. Customer support flow: ticket created, triaged, resolved...';
				div.appendChild(textarea);
				
				var status = document.createElement('div');
				status.style.color = '#c62828';
				status.style.fontSize = '11px';
				status.style.marginTop = '8px';
				status.style.minHeight = '14px';
				status.style.wordBreak = 'break-word';
				div.appendChild(status);
				
				var btns = document.createElement('div');
				btns.style.marginTop = '12px';
				btns.style.textAlign = 'right';
				div.appendChild(btns);
				
				var cancelBtn = mxUtils.button(mxResources.get('cancel'), function()
				{
					that.hideDialog();
				});
				cancelBtn.className = 'geBtn';
				cancelBtn.style.marginRight = '8px';
				btns.appendChild(cancelBtn);
				
				var genBtn = mxUtils.button(mxResources.get('generate') || 'Generate', function()
				{
					var prompt = textarea.value.trim();
					
					if (prompt.length === 0)
					{
						status.textContent = 'Please enter a prompt.';
						return;
					}
					
					genBtn.setAttribute('disabled', 'disabled');
					genBtn.style.opacity = '0.5';
					status.style.color = '#1f77b4';
					status.textContent = 'Generating...';
					
					fetch('/api/ai/generate', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ prompt: prompt, diagram_id: that.currentDiagramId })
					}).then(function(resp)
					{
						return resp.json().then(function(data)
						{
							return { ok: resp.ok, data: data };
						});
					}).then(function(result)
					{
						status.style.color = '#c62828';
						
						if (!result.ok)
						{
							status.textContent = result.data.error || 'Generation failed.';
							genBtn.removeAttribute('disabled');
							genBtn.style.opacity = '1';
							return;
						}
						
						var graph = that.editor.graph;
						var parent = graph.getDefaultParent();
						var cells = [];
						var cellMap = {};
						
						graph.model.beginUpdate();
						
						try
						{
							(result.data.nodes || []).forEach(function(n)
							{
								var style = SupabaseFile.getDefaultStyle(n.shape || 'process');
								var cell = graph.insertVertex(parent, n.id, n.label,
									n.x || 0, n.y || 0, n.w || 120, n.h || 60, style);
								cellMap[n.id] = cell;
								cells.push(cell);
							});
							
							(result.data.edges || []).forEach(function(e)
							{
								var src = cellMap[e.from];
								var tgt = cellMap[e.to];
								
								if (src != null && tgt != null)
								{
									cells.push(graph.insertEdge(parent, null, e.label || '',
										src, tgt, 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;'));
								}
							});
						}
						finally
						{
							graph.model.endUpdate();
						}
						
						graph.setSelectionCells(cells);
						that.hideDialog();
					}).catch(function(err)
					{
						status.style.color = '#c62828';
						status.textContent = 'Network error: ' + (err.message || 'unknown');
						genBtn.removeAttribute('disabled');
						genBtn.style.opacity = '1';
					});
				});
				genBtn.className = 'geBtn gePrimaryBtn';
				btns.appendChild(genBtn);
				
				that.showDialog(div, 400, 280, true, true, function()
				{
					textarea.value = '';
				});
				textarea.focus();
			}));
			
			// Append the AI entry to the Extras menu
			var extrasMenu = this.menus.get('extras');
			
			if (extrasMenu != null)
			{
				var origFunct = extrasMenu.funct;
				
				extrasMenu.funct = function(menu, parent)
				{
					origFunct.apply(this, arguments);
					
					if (that.currentDiagramId != null)
					{
						that.menus.addMenuItems(menu, ['-', 'aiGenerate'], parent);
					}
				};
			}
			
			// Opens an existing diagram from the dashboard
			if (this.currentDiagramId != null && this.currentDiagramId !== '')
			{
				var that = this;
				var file = new SupabaseFile(this, '', 'Untitled Diagram', this.currentDiagramId);
				
				// Retries the initial load: cold starts on flaky networks can
				// drop the versions request, which would otherwise leave the
				// user staring at the app's empty default file.
				var loadAttempts = 0;
				var loadFile = mxUtils.bind(this, function()
				{
					loadAttempts++;
					
file.getFileContent(mxUtils.bind(this, function(xml)
				{
					// Guard: the load callback can fire more than once (e.g. a
					// second XHR ready-state event with an empty response).
					// The empty result (a blank diagram, ~85 chars) is only
					// applied if no real response arrives shortly after, so
					// a racing empty response can never wipe a real diagram.
					if (that._diagramLoaded)
					{
						return;
					}
					
					if (xml == null || xml.length < 100)
					{
						if (that._emptyLoadTimer == null)
						{
							that._emptyLoadTimer = window.setTimeout(mxUtils.bind(this, function()
							{
								if (!that._diagramLoaded)
								{
									that._diagramLoaded = true;
									file.setData(xml);
									that.fileLoaded(file);
									
									if (typeof that.startRealtime === 'function')
									{
										that.startRealtime(file);
									}
								}
							}), 2500);
						}
						
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
					
					// Retry a couple of times before giving up (flaky cold
					// starts drop the versions request)
					if (loadAttempts < 3)
					{
						window.setTimeout(loadFile, 1000);
					}
					// Shows the default splash screen
					else if (urlParams['splash'] != '0')
					{
						that.showSplash();
					}
				}));
				});
				
				loadFile();
			}
		};
		
		// Add to global scope
		window.SupabaseFile = SupabaseFile;
	}
	
	setup();
})();