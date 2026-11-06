/* Hafif Merkezi: vurgular, tekrar, okuma, yazım projeleri ve künye denetimi tek, sekmeli pencerede.
 * Pencere tektir; sonraki çağrılar aynı pencereyi öne getirip istenen sekmeyi açar. */

Hafif.modules.hub = {
	_win: null,
	TABS: [
		["annots", "Vurgular"],
		["review", "Tekrar"],
		["reading", "Okuma"],
		["projects", "Projeler"],
		["lint", "Künye denetimi"],
	],

	open(tab) {
		let w = this._win;
		if (w && !w.closed) {
			w.focus();
			if (tab) w.HafifHub?.show(tab);
			return w;
		}
		this._win = Zotero.getMainWindow().openDialog("chrome://hafif/content/windows/hub.xhtml", "hafif-hub",
			"chrome,resizable,centerscreen,dialog=no,width=1100,height=760", { tab: tab || Hafif.pref("hubTab") || "annots" });
		return this._win;
	},

	shutdown() {
		if (this._win && !this._win.closed) this._win.close();
	},
};
