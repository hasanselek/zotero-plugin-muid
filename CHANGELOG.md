# Değişiklik günlüğü

## 1.0.0

İlk profesyonel sürüm: altyapı, yazma merkezi, okuma merkezi, tek pencere arayüz ve derinleştirilmiş yapay zekâ.

### Altyapı
- Paketler depodan çıkarıldı. Sürümler GitHub Releases'te yayımlanıyor ve otomatik güncelleme çalışıyor (`updates.json`).
- CI: sözdizimi ve manifest denetimi, çeviri anahtarı tutarlılığı, ESLint (sıfır uyarı), Zotero'suz birim testleri, paketleme.
- `compat.js`: Zotero'nun iç yapılarına bütün erişim tek katmanda toplandı.
- Yerelleştirme: Türkçe ve İngilizce çeviri dosyaları.
- API anahtarları parola yöneticisinde. Ayar dosyasında açık metin duran eski anahtarlar kendiliğinden taşınıyor.
- Açılış ölçümü ve performans raporu. Bazı modüller pencere boşta kalınca kuruluyor.
- Asistan için ayarlanabilir araştırmacı profili.

### Yazma
- Yazım projeleri: koleksiyon, bölümlü taslak ve atıf stili; proje durumu; kaynakçayı yenileme.
- Notu dışa aktarma: dipnotlu Word (.docx), Pandoc Markdown + CSL JSON, zengin metin.
- İSNAD künye denetimi ve güvenli otomatik düzeltmeler.
- Better BibTeX'siz atıf anahtarları.

### Okuma
- Hafif Merkezi: Vurgular, Tekrar, Okuma, Projeler ve Künye denetimi sekmeleri.
- Renk anlamları (`{{meaning}}`), aralıklı vurgu tekrarı, okuma takibi ve sağ panelde Okuma bölümü.
- Yan yana okuma.
- Ayarlarda arama.

### Yapay zekâ
- Alıntı doğrulama: not eylemi ve `verify_quote` aracı (asistan ve MCP).
- İlgili kaynaklar ve notlar (anlamca), literatür tarama matrisi.
- Kullanım ve tahmini maliyet takibi.
- Anlamsal aramada en iyi K seçimi; büyük dizinlerde puanlama ayrı iş parçacığında.

## 0.14.1 ve öncesi
Tek parça eklentinin ilk sürümleri: nota gönderme, not içindekiler, PDF içindekiler, eylemler ve kısayollar, hızlı arama, etiket ve sekme yönetimi, PDF taşıma, yapay zekâ asistanı, anlamsal arama, Literatür Ara, MCP sunucusu.
