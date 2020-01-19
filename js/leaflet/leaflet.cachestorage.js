
L.TileLayer.addInitHook(function() {
	if (!this.options.useCache) {
		this._cachename = null;
		return;
    } else {
        this._cacheName    = `offline-map-tiles`;
    }
});

// 🍂namespace TileLayer
// 🍂section PouchDB tile caching options
// 🍂option useCache: Boolean = false
// Whether to use a PouchDB cache on this tile layer, or not
L.TileLayer.prototype.options.useCache = false;

// 🍂option saveToCache: Boolean = true
// When caching is enabled, whether to save new tiles to the cache or not
L.TileLayer.prototype.options.saveToCache = true;

// 🍂option useOnlyCache: Boolean = false
// When caching is enabled, whether to request new tiles from the network or not
L.TileLayer.prototype.options.useOnlyCache = false;

// 🍂option cacheFormat: String = 'image/png'
// The image format to be used when saving the tile images in the cache
L.TileLayer.prototype.options.cacheFormat = "image/png";

// 🍂option cacheMaxAge: Number = 24*3600*1000
// Maximum age of the cache, in milliseconds
L.TileLayer.prototype.options.cacheMaxAge = 24 * 3600 * 1000;

L.TileLayer.include({

    _getCacheUrl: function(tileUrl){
        //return this._cacheName + tileUrl.replace('https://tile.openstreetmap.org/','/')
        return this._cachename + tileUrl.replace('http://a.tile.stamen.com/toner/','/')
    },


	// Overwrites L.TileLayer.prototype.createTile
	createTile: function(coords, done) {
		var tile = document.createElement("img");

		tile.onerror = L.bind(this._tileOnError, this, done, tile);

		if (this.options.crossOrigin) {
			tile.crossOrigin = "";
		}

		/*
		 Alt tag is *set to empty string to keep screen readers from reading URL and for compliance reasons
		 http://www.w3.org/TR/WCAG20-TECHS/H67
		 */
		tile.alt = "";

		var tileUrl = this.getTileUrl(coords);

		if (this.options.useCache) {
			this.getCacheData(
                tileUrl,
                this._onCacheLookup(tile, tileUrl, done)
			)
		} else {
			// Fall back to standard behaviour
			tile.onload = L.bind(this._tileOnLoad, this, done, tile);
			tile.src = tileUrl;
		}

		return tile;
	},

     
     // Get data from the cache.
     getCacheData: async function( tileUrl , callback) {
        cacheUrl = this._getCacheUrl(tileUrl);
        const cacheStorage   = await caches.open( this._cacheName );
        const cachedResponse = await cacheStorage.match( cacheUrl );
        if ( ! cachedResponse || ! cachedResponse.ok ) {
            return callback(Error(), null);
        }else{
            return callback(null, cachedResponse);
        }

     },
     
     
  
	// Returns a callback (closure over tile/key/originalSrc) to be run when the DB
	//   backend is finished with a fetch operation.
	_onCacheLookup: function(tile, tileUrl, done) {
		return function(err, data) {
			if (data) {
				return this._onCacheHit(tile, tileUrl, data, done);
			} else {
				return this._onCacheMiss(tile, tileUrl, done);
			}
		}.bind(this)
	},

	_onCacheHit: async function(tile, tileUrl, data, done) {
		this.fire("tilecachehit", {
			tile: tile,
			url: this._getCacheUrl(tileUrl),
        }); 

        await fetch(this._getCacheUrl(tileUrl))
        .then(
            function(response) {
                if (!response.ok) {
                    fetch(this._getCacheUrl(tileUrl)).then(
                        function(response){
                            if (!response.ok) {
                                throw new Error('HTTP error, status = ' + response.status);
                            }
                            return response.blob()
                        }
                    )
                
                }
                return response.blob();
            })
        .then(
            function(blob) {
                var url = URL.createObjectURL(blob);
                
                // Serve tile from cached data
                tile.onload = L.bind(this._tileOnLoad, this, done, tile);
                tile.crossOrigin = "Anonymous";
                //tile.src = url;
                tile.src = this._getCacheUrl(tileUrl);
				
			}.bind(this)    
        ).catch(function(err) {
            console.log("error:" + err);
        });
		
    },


	_onCacheMiss: function(tile, tileUrl, done) {
		this.fire("tilecachemiss", {
			tile: tile,
			url: tileUrl,
		});
		if (this.options.useOnlyCache) {
			// Offline, not cached
			console.log('Tile not in cache', tileUrl);
			tile.onload = L.Util.falseFn;
			tile.src = L.Util.emptyImageUrl;
		} else {
			// Online, not cached, request the tile normally
			if (this.options.saveToCache) {
				tile.onload = L.bind(
					this._saveTile,
					this,
					tile,
					tileUrl,
					undefined,
					done
				);
			} else {
				tile.onload = L.bind(this._tileOnLoad, this, done, tile);
			}
			tile.crossOrigin = "Anonymous";
			tile.src = tileUrl;
		}
	},

   
    // Async'ly saves the tile as a PouchDB attachment
	// Will run the done() callback (if any) when finished.
	_saveTile: async function(tile, tileUrl, existingRevision, done) {
		if (!this.options.saveToCache) {
			return;
        }

		var canvas = document.createElement("canvas");
		canvas.width = tile.naturalWidth || tile.width;
		canvas.height = tile.naturalHeight || tile.height;

		var context = canvas.getContext("2d");
		context.drawImage(tile, 0, 0);

		canvas.toBlob(
			async function(blob) {
                const cacheStorage   = await caches.open( this._cacheName );
                let cacheUrl = this._getCacheUrl(tileUrl)
                //console.log("saving " + cacheUrl)
                var init = { 'status': 200, 'Content-Type' : this.options.cacheFormat}
                cacheStorage.put( cacheUrl, new Response(blob,init)).then(function(resp) {
                    if (done) {
                        done();
                    }
                })
                .catch(function() {
                    if (done) {
                        done();
                    }
                });
                
			}.bind(this),
			this.options.cacheFormat
		);
    },

	

	_createTile: function() {
		return document.createElement("img");
	},

	// Modified L.TileLayer.getTileUrl, this will use the zoom given by the parameter coords
	//  instead of the maps current zoomlevel.
	_getTileUrl: function(coords) {
		var zoom = coords.z;
		if (this.options.zoomReverse) {
			zoom = this.options.maxZoom - zoom;
		}
		zoom += this.options.zoomOffset;
		return L.Util.template(
			this._url,
			L.extend(
				{
					r:
						this.options.detectRetina &&
						L.Browser.retina &&
						this.options.maxZoom > 0
							? "@2x"
							: "",
					s: this._getSubdomain(coords),
					x: coords.x,
					y: this.options.tms
						? this._globalTileRange.max.y - coords.y
						: coords.y,
					z: this.options.maxNativeZoom
						? Math.min(zoom, this.options.maxNativeZoom)
						: zoom,
				},
				this.options
			)
		);
	},

});