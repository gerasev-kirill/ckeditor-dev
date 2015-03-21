/**
 * @license Copyright (c) 2003-2015, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md or http://ckeditor.com/license
 */

( function() {
	'use strict';

	CKEDITOR.plugins.add( 'embedbase', {
		lang: 'en', // %REMOVE_LINE_CORE%
		requires: 'widget,notificationaggregator',

		onLoad: function() {
			CKEDITOR._.jsonpCallbacks = {};
		},

		init: function() {
			CKEDITOR.dialog.add( 'embedBase', this.path + 'dialogs/embedbase.js' );
		}
	} );

	function createWidgetBaseDefinition( editor ) {
		var aggregator,
			lang = editor.lang.embedbase;

		return {
			mask: true,
			template: '<div></div>',
			pathName: lang.pathName,
			// This cache object will be shared between all instances of this widget.
			_cache: {},
			urlRegExp: /^(?:(https?:|ftp:)?\/\/|www\.)[^\s\/$.?#].[^\s]*$/i,

			init: function() {
				this.on( 'sendRequest', function( evt ) {
					this._sendRequest( evt.data );
				}, this, null, 999 );

				// Expose the widget in the dialog - needed to trigger loadContent() and do error handling.
				this.on( 'dialog', function( evt ) {
					evt.data.widget = this;
				}, this );

				this.on( 'handleResponse', function( evt ) {
					if ( !evt.data.html ) {
						evt.data.html = this._responseToHtml( evt.data.url, evt.data.response );
					}
				}, this, null, 999 );
			},

			// We can't load content on #data, because that would make it rather impossible
			// to listen to load success and error.
			loadContent: function( url, opts ) {
				opts = opts || {};

				var that = this,
					cachedResponse = this._getCachedResponse( url ),
					request = {
						url: url,
						callback: finishLoading,
						errorCallback: function() {
							that._handleError( request );
							opts.errorCallback && opts.errorCallback();
						}
					};

				if ( cachedResponse ) {
					// Keep the async nature (it caused a bug the very first day when the loadContent()
					// was synchronous when cache was hit :D).
					setTimeout( function() {
						finishLoading( cachedResponse );
					} );
					return;
				}

				if ( !opts.noNotifications ) {
					request.task = this._createTask();
				}

				// The execution will be followed by #sendRequest's listener.
				this.fire( 'sendRequest', request );

				function finishLoading( response ) {
					that._cacheResponse( url, response );
					request.response = response;

					that._handleResponse( request );
					opts.callback && opts.callback();
				}
			},

			isUrlValid: function( url ) {
				return this.urlRegExp.test( url ) && ( this.fire( 'validateUrl', url ) !== false );
			},

			_sendRequest: function( request ) {
				Jsonp.sendRequest(
					this.providerUrl,
					{
						url: encodeURIComponent( request.url )
					},
					request.callback,
					request.errorCallback
				);
			},

			_handleResponse: function( request ) {
				if ( request.task ) {
					request.task.done();
				}

				var evtData = {
					url: request.url,
					html: '',
					response: request.response
				};

				if ( this.fire( 'handleResponse', evtData ) !== false ) {
					this._setContent( request.url, evtData.html );
				}
			},

			_handleError: function( request ) {
				if ( request.task ) {
					request.task.cancel();

					var warningMsg = new CKEDITOR.template( lang.fetchingSpecificFailed ).output(
						// TODO improve this.
						{ url: request.url.slice( 0, 40 ) + '...' }
					);
					editor.showNotification( warningMsg, 'warning' );
				}
			},

			_responseToHtml: function( url, response ) {
				if ( response.type == 'photo' ) {
					return '<img src="' + CKEDITOR.tools.htmlEncodeAttr( response.url ) + '" ' +
						'alt="' + CKEDITOR.tools.htmlEncodeAttr( response.title || '' ) + '" style="max-width:100%;height:auto" />';
				} else if ( response.type == 'link' ) {
					var title = CKEDITOR.tools.htmlEncodeAttr( response.title || '' ),
						// In case of the link type response may not contain url.
						linkUrl = response.url || url;

					return '<a href="' + CKEDITOR.tools.htmlEncodeAttr( linkUrl ) + '"' +
						// If title is available lets add it as an attribute.
						( title ? ' title="' + title + '"' : '' ) +
						'>' + CKEDITOR.tools.htmlEncode( linkUrl ) + '</a>';
				}

				// Types: video, rich.
				return response.html;
			},

			_setContent: function( url, content ) {
				this.setData( 'url', url );
				this.element.setHtml( content );
			},

			_createTask: function() {
				if ( !aggregator || aggregator.isFinished() ) {
					aggregator = new CKEDITOR.plugins.notificationAggregator( editor, lang.fetchingMany, lang.fetchingOne );

					aggregator.on( 'finished', function() {
						aggregator.notification.hide();
					} );
				}

				return aggregator.createTask();
			},

			_cacheResponse: function( url, response ) {
				this._cache[ url ] = response;
			},

			_getCachedResponse: function( url ) {
				return this._cache[ url ];
			}
		};
	}

	var Jsonp = {
		_attachScript: function( url, errorCallback ) {
			// ATM we can't use CKE scriptloader here, because it will make sure that script
			// with given URL is added only once.
			var script = new CKEDITOR.dom.element( 'script' );
			script.setAttribute( 'src', url );
			script.on( 'error', errorCallback );

			CKEDITOR.document.getBody().append( script );

			return script;
		},

		sendRequest: function( urlTemplate, urlParams, callback, errorCallback ) {
			urlParams = urlParams || {};

			var callbackKey = CKEDITOR.tools.getNextNumber(),
				scriptElement;

			urlParams.callback = 'CKEDITOR._.jsonpCallbacks[' + callbackKey + ']';

			CKEDITOR._.jsonpCallbacks[ callbackKey ] = function( response ) {
				// On IEs scripts are sometimes loaded synchronously. It is bad for two reasons:
				// * nature of sendRequest() is unstable,
				// * scriptElement does not exist yet.
				setTimeout( function() {
					cleanUp();
					callback( response );
				} );
			};

			scriptElement = this._attachScript( urlTemplate.output( urlParams ), function() {
				cleanUp();
				errorCallback();
			} );

			function cleanUp() {
				scriptElement.remove();
				delete CKEDITOR._.jsonpCallbacks[ callbackKey ];
			}
		}
	};

	CKEDITOR.plugins.embedBase = {
		createWidgetBaseDefinition: createWidgetBaseDefinition,
		_jsonp: Jsonp
	};

} )();