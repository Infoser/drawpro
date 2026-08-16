/**
 * RealtimeSync - Yjs collaboration for DrawPro diagrams
 *
 * Synchronizes the mxGraph model between collaborators using a Yjs document
 * (Y.Map of cells keyed by cell id, Y.Map viewport) transported over a
 * Supabase Realtime private channel:
 *
 *   - Broadcast 'y-update': incremental Yjs updates (base64) from local edits
 *   - Broadcast 'y-sync-request' / 'y-sync-state': full-state handshake for
 *     late joiners (seeds from the latest saved version, then pulls the
 *     full Yjs state from online peers to close the gap)
 *   - Presence: online collaborators + throttled cursor positions
 *
 * Loaded as a static script before app.min.js like SupabaseFile.js, so all
 * class definitions are deferred until the bundle has executed.
 */

(function()
{
	var patched = false;

	var COLORS = ['#d62728', '#2ca02c', '#9467bd', '#8c564b', '#e377c2',
		'#17becf', '#bcbd22', '#7f7f7f', '#ff7f0e', '#393b79'];

	function colorFor(key)
	{
		var h = 0;

		for (var i = 0; i < key.length; i++)
		{
			h = ((h << 5) - h + key.charCodeAt(i)) | 0;
		}

		return COLORS[Math.abs(h) % COLORS.length];
	}

	function base64ToBytes(b64)
	{
		var bin = atob(b64);
		var bytes = new Uint8Array(bin.length);

		for (var i = 0; i < bin.length; i++)
		{
			bytes[i] = bin.charCodeAt(i);
		}

		return bytes;
	}

	function bytesToBase64(bytes)
	{
		var bin = '';

		for (var i = 0; i < bytes.length; i++)
		{
			bin += String.fromCharCode(bytes[i]);
		}

		return btoa(bin);
	}

	function RealtimeSync(ui, file)
	{
		this.ui = ui;
		this.file = file;
		this.diagramId = file.diagramId;
		this.graph = ui.editor.graph;
		this.doc = new Y.Doc();
		this.channel = null;
		this.joined = false;
		this.role = null;
		this.instanceId = 'i' + Math.random().toString(36).slice(2);
		this.presence = {};        // clientId -> {email, name, color, cursor}
		this.cursorEls = {};       // clientId -> cursor overlay div
		this.avatarEl = null;      // in-editor avatar chip container
		this.syncing = false;      // remote apply in progress
		this.seeding = false;      // local Y transact while seeding
		this.updateBuf = [];       // pending incremental updates
		this.flushTimer = null;
		this.cursorTimer = null;
		this.localCursor = null;
		this.presenceTimer = null;
		this.pendingSync = false;
		this.cells = this.doc.getMap('cells');
		this.viewport = this.doc.getMap('viewport');
		this.cellCache = {};       // cellId -> serialized cell signature
		this.setup();
	}

	RealtimeSync.prototype.setup = function()
	{
		var that = this;

		// Listen to local model changes and mirror them into the Y doc
		this.graph.model.addListener(mxEvent.CHANGE, function()
		{
			if (!that.syncing && that.joined)
			{
				that.syncGraphToY();
			}
		});

		// Mirror local viewport changes (translate/scale)
		this.graph.view.addListener(mxEvent.TRANSLATE, function()
		{
			if (!that.syncing && that.joined)
			{
				that.syncViewport();
			}
		});
		this.graph.view.addListener(mxEvent.SCALE, function()
		{
			if (!that.syncing && that.joined)
			{
				that.syncViewport();
			}
		});

		// Apply remote Yjs state to the graph
		this.doc.on('update', function(update, origin)
		{
			// Only broadcast our own local edits; remote updates must not be
			// re-broadcast (echo loop) and seeding must stay silent
			if (origin !== 'local' || that.seeding)
			{
				return;
			}

			that.updateBuf.push(update);

			if (that.flushTimer == null)
			{
				that.flushTimer = setTimeout(function()
				{
					that.flushTimer = null;
					that.flushUpdates();
				}, 100);
			}
		});

		// Remote changes to cells or viewport -> rebuild the graph
		this.cells.observe(function()
		{
			if (!that.syncing)
			{
				that.applyRemote();
			}
		});
		this.viewport.observe(function()
		{
			if (!that.syncing)
			{
				that.applyRemoteViewport();
			}
		});

		// Cursor tracking (graph coordinates, throttled)
		this.graph.container.addEventListener('mousemove', function(evt)
		{
			var graph = that.graph;
			var rect = graph.container.getBoundingClientRect();
			var view = graph.view;

			that.localCursor = {
				x: (evt.clientX - rect.left - view.translate.x) / view.scale,
				y: (evt.clientY - rect.top - view.translate.y) / view.scale
			};

			if (that.cursorTimer == null)
			{
				that.cursorTimer = setTimeout(function()
				{
					that.cursorTimer = null;
					that.updatePresence();
				}, 100);
			}
		});

		// Resolve this user's role via the collaborators API
		file.callApi('/api/diagrams/' + this.diagramId + '/collaborators', 'GET', null,
			function(rows)
			{
				that.applyRole(rows);
			}, function()
			{
				that.applyRole(null);
			});
	};

	RealtimeSync.prototype.applyRole = function(rows)
	{
		var that = this;
		var session = null;

		this.ui.supabaseClient.auth.getSession().then(function(resp)
		{
			session = resp.data.session;

			if (session == null)
			{
				that.role = null;
				that.connect(session);
				return;
			}

			that.role = 'owner';
			var email = session.user.email;

			if (rows != null)
			{
				for (var i = 0; i < rows.length; i++)
				{
					if (rows[i].email === email)
					{
						that.role = rows[i].role;
						break;
					}
				}
			}

			that.connect(session);
		}).catch(function()
		{
			that.connect(null);
		});
	};

	RealtimeSync.prototype.connect = function(session)
	{
		if (session == null)
		{
			console.warn('[RealtimeSync] no session, realtime disabled');
			return;
		}

		var that = this;
		var user = session.user;

		this.userId = user.id;
		this.userEmail = user.email || 'unknown';
		this.userName = (user.email || 'unknown').split('@')[0];
		this.color = colorFor(this.userId);

		// Viewers receive live updates but cannot edit
		if (this.role === 'viewer' || this.role === 'commenter')
		{
			this.graph.setEnabled(false);
		}

		this.channel = this.ui.supabaseClient.channel('diagram:' + this.diagramId,
			{config: {private: true}});

		this.channel.on('broadcast', {event: 'y-update'}, function(msg)
		{
			that.onRemoteUpdate(msg);
		});

		this.channel.on('broadcast', {event: 'y-sync-request'}, function()
		{
			// Respond with the full current state (idempotent for all peers)
			that.sendState();
		});

		this.channel.on('broadcast', {event: 'y-sync-state'}, function(msg)
		{
			that.onRemoteUpdate(msg);
		});

		this.channel.on('presence', {event: 'sync'}, function()
		{
			that.renderPresence();
		});

		this.channel.on('presence', {event: 'join'}, function()
		{
			that.renderPresence();
		});

		this.channel.on('presence', {event: 'leave'}, function()
		{
			that.renderPresence();
		});

		this.channel.subscribe(function(status)
		{
			if (status === 'SUBSCRIBED')
			{
				that.joined = true;
				that.seed();
				that.updatePresence();
				// Ask online peers for their full state so we do not miss
				// any edits made between the version snapshot and joining
				that.sendRequest();
				console.log('[RealtimeSync] joined channel diagram:' + that.diagramId);
			}
			else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
			{
				console.warn('[RealtimeSync] channel status: ' + status);
			}
		});
	};

	// Seeds the Y doc from the diagram XML that was loaded from the API.
	// Runs once on channel join, before any remote state is applied.
	RealtimeSync.prototype.seed = function()
	{
		this.seeding = true;

		try
		{
			var xml = this.file.getData();

			if (xml != null && xml.length > 0)
			{
				var doc = mxUtils.parseXml(xml);
				var cells = doc.documentElement.getElementsByTagName('mxCell');

				this.doc.transact(function()
				{
					for (var i = 0; i < cells.length; i++)
					{
						this.putCell(cells[i]);
					}

					this.syncViewportInto();
				}.bind(this), 'local');
			}
		}
		catch (e)
		{
			console.warn('[RealtimeSync] seed failed:', e);
		}

		this.seeding = false;
	};

	RealtimeSync.prototype.serializeCell = function(cell)
	{
		var attrs = {};

		for (var i = 0; i < cell.attributes.length; i++)
		{
			var attr = cell.attributes[i];
			attrs[attr.name] = attr.value;
		}

		var geo = null;
		var children = cell.children;

		for (var j = 0; j < children.length; j++)
		{
			if (children[j].nodeName === 'mxGeometry')
			{
				geo = {attrs: {}, points: []};

				for (var k = 0; k < children[j].attributes.length; k++)
				{
					var gattr = children[j].attributes[k];
					geo.attrs[gattr.name] = gattr.value;
				}

				for (var m = 0; m < children[j].children.length; m++)
				{
					var pt = children[j].children[m];
					var ptAttrs = {};

					for (var n = 0; n < pt.attributes.length; n++)
					{
						ptAttrs[pt.attributes[n].name] = pt.attributes[n].value;
					}

					geo.points.push({name: pt.nodeName, attrs: ptAttrs});
				}

				break;
			}
		}

		return JSON.stringify({a: attrs, g: geo});
	};

	RealtimeSync.prototype.putCell = function(xmlCell)
	{
		var id = xmlCell.getAttribute('id');

		if (id == null || id === '')
		{
			return;
		}

		var sig = this.serializeCell(xmlCell);

		if (this.cellCache[id] === sig)
		{
			return;
		}

		this.cellCache[id] = sig;
		this.cells.set(id, sig);
	};

	// Serializes the current graph model into the Y cells map
	RealtimeSync.prototype.syncGraphToY = function()
	{
		try
		{
			var graphXml = this.ui.editor.getGraphXml();
			var doc = mxUtils.parseXml(mxUtils.getXml(graphXml));
			var cells = doc.documentElement.getElementsByTagName('mxCell');
			var live = {};

			this.doc.transact(function()
			{
				for (var i = 0; i < cells.length; i++)
				{
					var id = cells[i].getAttribute('id');

					if (id != null && id !== '')
					{
						live[id] = true;
						this.putCell(cells[i]);
					}
				}

				// Remove cells that no longer exist in the model
				for (var key in this.cellCache)
				{
					if (this.cellCache.hasOwnProperty(key) && !live[key])
					{
						delete this.cellCache[key];
						this.cells.delete(key);
					}
				}

				this.syncViewportInto();
			}.bind(this), 'local');
		}
		catch (e)
		{
			console.warn('[RealtimeSync] syncGraphToY failed:', e);
		}
	};

	RealtimeSync.prototype.syncViewportInto = function()
	{
		var view = this.graph.view;

		if (this.viewport.get('tx') !== view.translate.x)
		{
			this.viewport.set('tx', view.translate.x);
		}

		if (this.viewport.get('ty') !== view.translate.y)
		{
			this.viewport.set('ty', view.translate.y);
		}

		if (this.viewport.get('scale') !== view.scale)
		{
			this.viewport.set('scale', view.scale);
		}
	};

	RealtimeSync.prototype.syncViewport = function()
	{
		this.doc.transact(function()
		{
			this.syncViewportInto();
		}.bind(this), 'local');
	};

	// Builds mxfile XML from the Y cells map (mirror of SupabaseFile.convertToMxGraph)
	RealtimeSync.prototype.toMxfileXml = function()
	{
		var xml = '<mxfile host="DrawPro" agent="DrawPro" version="1.0" type="device">\n';
		xml += '  <diagram id="' + this.diagramId + '" name="' + mxUtils.htmlEntities(this.file.getTitle()) + '">\n';
		xml += '    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">\n';
		xml += '      <root>\n';

		this.cells.forEach(function(sig)
		{
			var cell = JSON.parse(sig);

			if (cell.a.parent !== '0')
			{
				return;
			}

			xml += '        <mxCell';

			for (var attr in cell.a)
			{
				if (cell.a.hasOwnProperty(attr))
				{
					xml += ' ' + attr + '="' + mxUtils.htmlEntities(cell.a[attr]) + '"';
				}
			}

			if (cell.g != null)
			{
				xml += '>\n          <mxGeometry';

				for (var gattr in cell.g.attrs)
				{
					if (cell.g.attrs.hasOwnProperty(gattr))
					{
						xml += ' ' + gattr + '="' + mxUtils.htmlEntities(cell.g.attrs[gattr]) + '"';
					}
				}

				if (cell.g.points.length > 0)
				{
					xml += '>\n';

					for (var i = 0; i < cell.g.points.length; i++)
					{
						var pt = cell.g.points[i];
						xml += '            <' + pt.name;

						for (var pattr in pt.attrs)
						{
							if (pt.attrs.hasOwnProperty(pattr))
							{
								xml += ' ' + pattr + '="' + mxUtils.htmlEntities(pt.attrs[pattr]) + '"';
							}
						}

						xml += '/>\n';
					}

					xml += '          </mxGeometry>\n        </mxCell>\n';
				}
				else
				{
					xml += '/>\n        </mxCell>\n';
				}
			}
			else
			{
				xml += '/>\n';
			}
		});

		xml += '      </root>\n';
		xml += '    </mxGraphModel>\n';
		xml += '  </diagram>\n';
		xml += '</mxfile>';

		return xml;
	};

	// Applies the Y cells map to the graph model
	RealtimeSync.prototype.applyRemote = function()
	{
		try
		{
			this.syncing = true;
			var xml = this.toMxfileXml();
			var doc = mxUtils.parseXml(xml);
			this.ui.editor.setGraphXml(doc.documentElement);
		}
		catch (e)
		{
			console.warn('[RealtimeSync] applyRemote failed:', e);
		}
		finally
		{
			this.syncing = false;
		}
	};

	RealtimeSync.prototype.applyRemoteViewport = function()
	{
		try
		{
			this.syncing = true;
			var tx = this.viewport.get('tx');
			var ty = this.viewport.get('ty');
			var scale = this.viewport.get('scale');

			if (tx != null && ty != null && scale != null)
			{
				this.graph.view.setScale(scale);
				this.graph.view.setTranslate(tx, ty);
			}
		}
		finally
		{
			this.syncing = false;
		}
	};

	// Flushes accumulated incremental updates to the channel
	RealtimeSync.prototype.flushUpdates = function()
	{
		if (this.updateBuf.length === 0)
		{
			return;
		}

		var total = 0;

		for (var i = 0; i < this.updateBuf.length; i++)
		{
			total += this.updateBuf[i].length;
		}

		var merged = new Uint8Array(total);
		var offset = 0;

		for (var j = 0; j < this.updateBuf.length; j++)
		{
			merged.set(this.updateBuf[j], offset);
			offset += this.updateBuf[j].length;
		}

		this.updateBuf = [];

		if (this.joined)
		{
			this.channel.send({
				type: 'broadcast',
				event: 'y-update',
				payload: {b: bytesToBase64(merged)}
			});
		}
	};

	RealtimeSync.prototype.sendState = function()
	{
		if (!this.joined)
		{
			return;
		}

		var state = Y.encodeStateAsUpdate(this.doc);

		this.channel.send({
			type: 'broadcast',
			event: 'y-sync-state',
			payload: {b: bytesToBase64(state)}
		});
	};

	RealtimeSync.prototype.sendRequest = function()
	{
		if (this.joined)
		{
			this.channel.send({type: 'broadcast', event: 'y-sync-request'});
		}
	};

	RealtimeSync.prototype.onRemoteUpdate = function(msg)
	{
		if (msg == null || msg.payload == null || msg.payload.b == null)
		{
			return;
		}

		try
		{
			Y.applyUpdate(this.doc, base64ToBytes(msg.payload.b));
		}
		catch (e)
		{
			console.warn('[RealtimeSync] applyUpdate failed:', e);
		}
	};

	RealtimeSync.prototype.updatePresence = function()
	{
		var state = {
			instanceId: this.instanceId,
			user: {
				id: this.userId,
				email: this.userEmail,
				name: this.userName,
				color: this.color
			},
			cursor: this.localCursor
		};

		this.channel.track(state);
		this.schedulePresence();
	};

	RealtimeSync.prototype.schedulePresence = function()
	{
		var that = this;

		if (this.presenceTimer != null)
		{
			return;
		}

		this.presenceTimer = setTimeout(function()
		{
			that.presenceTimer = null;
			that.renderPresence();
			that.notifyParent();
		}, 50);
	};

	RealtimeSync.prototype.getPeers = function()
	{
		var state = this.channel.presenceState();
		var peers = [];

		for (var clientId in state)
		{
			if (state.hasOwnProperty(clientId))
			{
				var metas = state[clientId];

				for (var i = 0; i < metas.length; i++)
				{
					var meta = metas[i];

					if (meta.instanceId != null && meta.instanceId !== this.instanceId)
					{
						peers.push({
							clientId: clientId,
							id: meta.user.id,
							email: meta.user.email,
							name: meta.user.name,
							color: meta.user.color,
							cursor: meta.cursor || null
						});
					}
				}
			}
		}

		return peers;
	};

	RealtimeSync.prototype.renderPresence = function()
	{
		var peers = this.getPeers();
		var live = {};
		var container = this.graph.container;

		for (var i = 0; i < peers.length; i++)
		{
			var peer = peers[i];
			live[peer.clientId] = true;

			if (this.cursorEls[peer.clientId] == null)
			{
				var el = document.createElement('div');
				el.className = 'dp-cursor';
				el.style.position = 'absolute';
				el.style.pointerEvents = 'none';
				el.style.zIndex = '1000';
				el.style.background = peer.color;
				el.style.color = '#ffffff';
				el.style.fontSize = '11px';
				el.style.padding = '1px 5px';
				el.style.borderRadius = '10px';
				el.style.whiteSpace = 'nowrap';
				el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';

				var dot = document.createElement('span');
				dot.style.display = 'inline-block';
				dot.style.width = '8px';
				dot.style.height = '8px';
				dot.style.borderRadius = '50%';
				dot.style.background = '#ffffff';
				dot.style.marginRight = '4px';
				dot.style.verticalAlign = 'middle';
				el.appendChild(dot);
				el.appendChild(document.createTextNode(peer.name));
				container.appendChild(el);
				this.cursorEls[peer.clientId] = el;
			}

			var cursorEl = this.cursorEls[peer.clientId];

			if (peer.cursor != null)
			{
				var view = this.graph.view;
				var x = peer.cursor.x * view.scale + view.translate.x;
				var y = peer.cursor.y * view.scale + view.translate.y;
				cursorEl.style.display = 'block';
				cursorEl.style.left = Math.round(x + 10) + 'px';
				cursorEl.style.top = Math.round(y + 10) + 'px';
			}
			else
			{
				cursorEl.style.display = 'none';
			}
		}

		for (var clientId in this.cursorEls)
		{
			if (this.cursorEls.hasOwnProperty(clientId) && !live[clientId])
			{
				this.cursorEls[clientId].parentNode.removeChild(this.cursorEls[clientId]);
				delete this.cursorEls[clientId];
			}
		}

		this.renderAvatars(peers);
	};

	RealtimeSync.prototype.renderAvatars = function(peers)
	{
		if (this.avatarEl == null)
		{
			var el = document.createElement('div');
			el.id = 'dp-avatars';
			el.style.position = 'fixed';
			el.style.top = '8px';
			el.style.right = '8px';
			el.style.zIndex = '2000';
			el.style.display = 'flex';
			el.style.flexDirection = 'row-reverse';
			el.style.gap = '4px';
			document.body.appendChild(el);
			this.avatarEl = el;
		}

		this.avatarEl.innerHTML = '';

		for (var i = 0; i < peers.length; i++)
		{
			var chip = document.createElement('div');
			chip.style.width = '26px';
			chip.style.height = '26px';
			chip.style.borderRadius = '50%';
			chip.style.background = peers[i].color;
			chip.style.color = '#ffffff';
			chip.style.display = 'flex';
			chip.style.alignItems = 'center';
			chip.style.justifyContent = 'center';
			chip.style.fontSize = '11px';
			chip.style.fontWeight = 'bold';
			chip.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';
			chip.style.cursor = 'default';
			chip.title = peers[i].email + ' (viewing)';
			chip.textContent = peers[i].name.substring(0, 1).toUpperCase();
			this.avatarEl.appendChild(chip);
		}
	};

	RealtimeSync.prototype.notifyParent = function()
	{
		try
		{
			window.parent.postMessage({
				source: 'drawpro-editor',
				type: 'presence',
				users: this.getPeers().map(function(peer)
				{
					return {name: peer.name, email: peer.email, color: peer.color};
				}),
				online: this.getPeers().length + 1
			}, '*');
		}
		catch (e)
		{
			// ignore cross-origin issues
		}
	};

	RealtimeSync.prototype.destroy = function()
	{
		if (this.channel != null)
		{
			this.channel.unsubscribe();
		}

		if (this.flushTimer != null)
		{
			clearTimeout(this.flushTimer);
		}

		if (this.cursorTimer != null)
		{
			clearTimeout(this.cursorTimer);
		}

		if (this.presenceTimer != null)
		{
			clearTimeout(this.presenceTimer);
		}

		this.doc.destroy();
	};

	function setup()
	{
		if (patched)
		{
			return;
		}

		if (typeof window.DrawioFile === 'undefined' ||
			typeof window.mxUtils === 'undefined' ||
			typeof window.EditorUi === 'undefined' ||
			typeof window.Y === 'undefined')
		{
			setTimeout(setup, 50);
			return;
		}

		patched = true;

		// Start realtime sync once a diagram file has been loaded
		EditorUi.prototype.startRealtime = function(file)
		{
			if (this.realtimeSync != null)
			{
				this.realtimeSync.destroy();
				this.realtimeSync = null;
			}

			if (file != null && file.diagramId != null && this.supabaseClient != null)
			{
				this.realtimeSync = new RealtimeSync(this, file);
				window.editor.realtime = this.realtimeSync;
			}

			return this.realtimeSync;
		};

		window.RealtimeSync = RealtimeSync;
	}

	setup();
})();