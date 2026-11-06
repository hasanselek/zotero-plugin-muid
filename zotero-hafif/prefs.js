// Hızlı arama kısayolu: Cmd+Shift+<harf> (Windows/Linux'ta Ctrl+Shift+<harf>)
pref("extensions.hafif.searchKey", "P");
// Konu notlarının durduğu koleksiyonlar (JSON: ["libraryID/key"]); boşsa "Notlar" ve "Notlarım"
pref("extensions.hafif.notesCollections", "");
// Son gönderilen hedef (JSON: libraryID, key, heading)
pref("extensions.hafif.lastTarget", "");
// Gönderilen vurgu ve seçimlerin biçimi: metin blok alıntı, yorumunuz altında ayrı paragraf
pref("extensions.hafif.quoteTemplate", "<blockquote><p>{{highlight}} {{citation}}</p></blockquote>{{if comment}}<p>{{comment}}</p>{{endif}}");
// Okuyucuda yeni yapılan vurguları son hedefe kendiliğinden gönder
pref("extensions.hafif.autoAppend", false);
// Not düzenleyicilerinde yüzen, sürükle-bırakla düzenlenebilen içindekiler kutusu
pref("extensions.hafif.noteOutline", true);
// Kutunun konumu ve boyutu (dar ve geniş düzenleyici için ayrı)
pref("extensions.hafif.noteOutlineState", "");
// Eylemler: kısayollar, sağ tık menüsündekiler, otomatik kurallar, özel betikler, okuma etiketleri (JSON; boşsa varsayılanlar)
pref("extensions.hafif.actionKeys", "");
pref("extensions.hafif.actionMenu", "");
pref("extensions.hafif.actionRules", "");
pref("extensions.hafif.actionScripts", "");
pref("extensions.hafif.readTags", "");
// Yapay zekâ asistanı: sağlayıcı anahtarları, yerel sunucular, özel uç noktalar, seçili model, model listesi önbelleği (JSON)
pref("extensions.hafif.aiKeys", "");
pref("extensions.hafif.aiBases", "");
pref("extensions.hafif.aiLocal", "");
pref("extensions.hafif.aiCustom", "");
pref("extensions.hafif.aiChatModel", "");
pref("extensions.hafif.aiModelCache", "");
pref("extensions.hafif.aiInstructions", "");
pref("extensions.hafif.aiWebSearch", false);
// Görünüm: yüzer sol panel ve genişliği; notlarda vurgu üstünde sayfa önizlemesi
pref("extensions.hafif.leftFloat", false);
pref("extensions.hafif.leftFloatWidth", "");
pref("extensions.hafif.notePreview", true);
// Yüzer sol panelin konumu ve boyutu (JSON)
pref("extensions.hafif.leftFloatGeom", "");
// Kayıt listesinde boşluk tuşuyla Hızlı Bakış (bütün sayfaların önizlemesi)
pref("extensions.hafif.quickLook", true);
// Asistan PDF'e vurgu eklemeden önce sormasın (önerilmez)
pref("extensions.hafif.aiAutoApprove", false);
// Anlamsal arama: gömme modeli ("sağlayıcı:model"), PDF tam metinleri de dizinlensin mi, değişince kendiliğinden güncellensin mi
pref("extensions.hafif.aiEmbed", "");
pref("extensions.hafif.aiEmbedFulltext", false);
pref("extensions.hafif.aiEmbedAuto", true);
// Dış literatür araması (OpenAlex)
pref("extensions.hafif.aiExternal", true);
// MCP sunucusu (Claude Desktop / Claude Code için): açık mı, yeni not oluşturmaya izin, erişim anahtarı
pref("extensions.hafif.mcpEnabled", false);
pref("extensions.hafif.mcpWrite", false);
pref("extensions.hafif.mcpToken", "");
// Literatür Ara: kapalı kaynaklar, son süzgeçler, doğal dil yorumu
pref("extensions.hafif.litOff", "");
pref("extensions.hafif.litLast", "");
pref("extensions.hafif.litAI", true);
