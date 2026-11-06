# Zotero Hafif

**Zotero 7+ için tek parça, hafif bir araştırma, okuma ve yazma eklentisi.** Çok sayıda ayrı eklentinin işini tek çatı altında toplar. Açılışta yalnızca küçük bir çekirdek yüklenir; her özellik ilk kullanıldığında devreye girer. Bu yüzden Zotero'yu yavaşlatmaz.

İslâm ilimleri alanında Türkçe, Arapça ve Batı dillerinde çalışan araştırmacılar düşünülerek yazıldı. Arapça hareke, transkripsiyon, hicrî tarih ve İSNAD atıf sistemi gibi ihtiyaçları ilk elden karşılar, ama her alanda kullanılabilir.

## Neler var

### Okuma
- **Nota gönder:** Vurguyu ya da seçili metni, konu notlarınızdaki seçtiğiniz başlığın altına atıf ve sayfa bağlantısıyla ekler. Son hedefe otomatik gönderme seçeneği de var.
- **Vurgu panosu** (Hafif Merkezi › Vurgular): Bütün kütüphanedeki vurgular tek listede. Renge, türe, metne, tarihe ve koleksiyona göre süzülür; seçilenler nota gönderilir ya da Markdown'a aktarılır.
- **Renk anlamları:** Her renge bir anlam verirsiniz (ör. sarı = önemli, kırmızı = itiraz). Bu anlam panoda, nota giden alıntıda (`{{meaning}}`) ve asistanın vurgu aramalarında kullanılır.
- **Vurgu tekrarı:** Leitner kutularıyla aralıklı tekrar. Her gün eski vurgularınızdan birkaçı yeniden önünüze gelir.
- **Okuma takibi:** Hangi eseri ne kadar okuduğunuz, ilerleme ve son okuma tarihi. Sağ panelde "Okuma" bölümü ve son iki haftanın grafiği var. İsterseniz okunuyor/okundu etiketleri kendiliğinden verilir. Veriler yalnızca bu bilgisayarda tutulur.
- **Yan yana okuma:** İki eser ekranı ikiye bölerek açılır (ör. metin ve tercümesi, metin ve şerhi).
- **Diğerleri:** PDF içindekiler düzenleyici, notlarda vurgu üstünde sayfa önizlemesi, boşluk tuşuyla Hızlı Bakış, odak modu ve tam ekran.

### Yazma
- **Yazım projeleri:** Makale, tez, bölüm ya da tebliğ için bir kaynak koleksiyonu, bölümlü bir taslak notu ve bir atıf stilini tek projede bir araya getirir. Okurken yapılan vurgular doğrudan taslağa gider. Proje durumu ekranı sözcük sayısını, atıfları, atıf yapılmamış kaynakları ve koleksiyon dışında kalan atıfları gösterir. Kaynakça tek tuşla yenilenir.
- **Dışa aktarma:**
  - Word (.docx): gerçek Word dipnotlarıyla. citeproc, *a.g.e./ibid.* kısaltmalarını sırasıyla uygular; kaynakça eklenir; Arapça paragraflar sağdan sola dizilir.
  - Pandoc Markdown + CSL JSON.
  - Zengin metin olarak panoya.
- **Künye denetimi (İSNAD):** Eksik zorunlu alanları, BÜYÜK HARFLİ başlık ve adları, ISBN sağlamasını, DOI biçimini, hicrî yıl ipuçlarını, sayfa biçimini, dil kodunu ve transkripsiyon tutarlılığını denetler. Güvenli düzeltmeler tek tuşla yapılır ya da bir kurala bağlanır.
- **Atıf anahtarları:** Better BibTeX gerektirmeden tekil `yazarYılKelime` anahtarları üretir.
- **Diğerleri:** Not şablonları, yüzen not içindekiler (başlıkları sürükleyerek bölümleri taşıma), atıf paneli.

### Kütüphane düzeni
- Toplu alan düzenleme ve başlık düzeni (İSNAD/APA).
- Büyük harfli yazar adlarını düzeltme ve dosyaları yeniden adlandırma.
- PDF'i klasöre taşıma.
- Okuma etiketleri, otomatik kurallar ve kendi JavaScript betikleriniz.
- Etiket gezgini, sekme yöneticisi, yüzer kitaplık paneli, sade bilgi paneli.
- Arapça ve transkripsiyondan bağımsız hızlı arama.
- Bütün bunlar **eylem paletinden** (⌘⇧K) yazarak bulunur; her eyleme kısayol verilebilir.

### Yapay zekâ (isteğe bağlı)
- **Sohbet paneli** (⌘J): Kütüphanenizde arar, PDF okur, vurgu ve notlarınıza bakar, cevapları sayfa atıflarıyla verir. Anthropic, OpenAI, Gemini, OpenRouter, Mistral, DeepSeek, Groq, xAI, Ollama, LM Studio ve kendi uç noktalarınızla çalışır.
- **Anlamsal arama:** Yerel gömme dizini kurulur; büyük dizinlerde puanlama arayüzü dondurmadan ayrı bir iş parçacığında yapılır.
- **Alıntı doğrulama:** Nottaki tırnaklı alıntılar kaynağın PDF'inde aranır; metnin orada olup olmadığı ve atıftaki sayfada geçip geçmediği denetlenir.
- **Araştırma araçları:** Literatür tarama matrisi, karşılaştırma tablosu, OCR, PDF'ten künye çıkarma.
- **Literatür arama:** YÖK Tez, DergiPark, TDV İslâm Ansiklopedisi ve OpenAlex'te aranır, sonuçlar tam künyesiyle eklenir.
- **Kullanım ve maliyet takibi:** Model başına aylık belirteç sayıları tutulur; kendi fiyatlarınızı girerseniz tahmini tutar da gösterilir.
- **MCP sunucusu:** Claude Desktop ve Claude Code kütüphanenizi okuyabilir.

## Kurulum

1. [Sürümler](https://github.com/hasanselek/zotero-plugin-muid/releases) sayfasından en son `zotero-hafif-x.y.z.xpi` dosyasını indirin.
2. Zotero'da **Araçlar › Eklentiler**'i açın. Dişli simgesinden **Dosyadan eklenti yükle…** deyip indirdiğiniz dosyayı seçin.
3. Ayarlar **Zotero Ayarları › Hafif** altındadır.

Sonraki sürümler Zotero tarafından kendiliğinden güncellenir.

## Gizlilik

- API anahtarları Zotero'nun parola yöneticisinde saklanır, ayar dosyasında açık metin olarak durmaz.
- Okuma, tekrar ve kullanım verileri Zotero veri klasörünün `hafif/` alt klasöründe kalır.
- Yapay zekâ özelliklerini kullanmadıkça hiçbir veri dışarı gönderilmez. Kullandığınızda yalnızca seçtiğiniz sağlayıcıya gider.

## Geliştirme

```bash
npm ci
```

```bash
npm run ci
```

`npm run ci` sırasıyla şunları çalıştırır:
- `check`: sözdizimi, manifest, çeviri anahtarları, modül adları
- `lint`: ESLint, sıfır uyarı
- `test`: Zotero'suz birim testleri
- `build`: `zotero-hafif/dist/` altına `.xpi`

Zotero içinde uçtan uca deneme için `extensions.hafif.selfTest` ayarını açın. Zotero'yu yeniden başlatınca sonuçlar **Yardım › Hata ayıklama çıktısı** içinde `[Hafif TEST]` önekiyle görünür.

**Sürüm çıkarmak:** `zotero-hafif/manifest.json` dosyasında sürümü artırıp commit'leyin. Ardından aşağıdaki komutla etiketi gönderin. GitHub Actions `.xpi` dosyasını ve otomatik güncelleme dosyası `updates.json`'u sürüme ekler.

```bash
git tag v1.2.3 && git push origin v1.2.3
```

### Mimari

| Yer | Ne |
|---|---|
| `bootstrap.js` | Zotero'nun giriş noktası. Yalnızca `content/core.js` yüklenir. |
| `content/core.js` | Menüler, kısayollar, okuyucu ve panel kayıtları. `Hafif.load(ad)` modülleri ilk kullanımda yükler; `Hafif.t(id)` çeviri; `Hafif.perf` ölçümler. |
| `content/modules/compat.js` | Zotero'nun iç yapılarına bütün erişim burada. Zotero güncellemesi bir şeyi kırarsa yalnızca bu dosya düzeltilir. |
| `content/modules/*.js` | Her özellik bir modül (`Hafif.modules.ad = {…}`). |
| `content/windows/` | Ayrı pencereler (Hafif Merkezi, Literatür Ara, içindekiler…) ve işçiler. |
| `locale/tr-TR`, `locale/en-US` | Fluent çeviri dosyaları. |
| `tests/` | `node --test` birim testleri. `tests/harness.mjs` modülleri Zotero'suz yükler. |

Ayarlar sayfasındaki **Gelişmiş › Performans raporu**, açılış süresini ve hangi modülün ne kadar sürede yüklendiğini gösterir.

## Lisans

MIT. `content/lib/pdf-lib.min.js` MIT lisanslıdır (Andrew Dillon).
