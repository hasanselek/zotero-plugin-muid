/* Not içindekiler penceresi: tek pencere açılır, sonraki çağrılar aynı pencerede gösterir. */

Hafif.modules.toc = {
	_win: null,

	open(focus = {}) {
		let win = this._win;
		if (win && !win.closed) {
			win.focus();
			win.HafifTOC?.show(focus);
			return win;
		}
		this._win = Zotero.getMainWindow().openDialog(
			"chrome://hafif/content/windows/toc.xhtml", "hafif-toc",
			"chrome,resizable,centerscreen,dialog=no,width=1180,height=780", focus);
		return this._win;
	},

	shutdown() {
		if (this._win && !this._win.closed) this._win.close();
		this._win = null;
	},
};
