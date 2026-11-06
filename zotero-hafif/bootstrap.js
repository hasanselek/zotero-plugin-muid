/* Zotero Hafif — giriş noktası.
 * Açılışta yalnızca core.js yüklenir; özellik modülleri ilk kullanıldıklarında yüklenir. */

var Hafif;

function install() {}

async function startup({ id, version, rootURI }) {
	Services.scriptloader.loadSubScript(rootURI + "content/core.js");
	Hafif.init({ id, version, rootURI, scope: this });
	await Hafif.startup();
}

function onMainWindowLoad({ window }) {
	Hafif?.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
	Hafif?.onMainWindowUnload(window);
}

function shutdown() {
	Hafif?.shutdown();
	Hafif = undefined;
}

function uninstall() {}
