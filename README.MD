# 🚀 Node Launcher

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg) ![Electron](https://img.shields.io/badge/Electron-24.0.0+-green.svg) ![License](https://img.shields.io/badge/license-MIT-orange.svg) ![Author](https://img.shields.io/badge/Author-Kerem%20Zayim-red)

**Node Launcher**, geliştiricilerin birden fazla Node.js projesini (botlar, sunucular, API'ler) tek bir merkezi panelden yönetmesini, izlemesini ve otomatik başlatmasını sağlayan güçlü bir masaüstü uygulamasıdır.

<img width="1097" height="747" alt="Screenshot_1277" src="https://github.com/user-attachments/assets/57a6204c-48ab-489f-86e8-b32f9b8b2eb7" />

---

## 🌟 Özellikler

* **📂 Proje Yönetimi:** İstediğiniz kadar Node.js projesini dosya gezgini ile kolayca ekleyin.
* **⚡ Otomatik Başlatma:** Bilgisayar açıldığında veya program başladığında seçtiğiniz projeleri otomatik çalıştırır.
* **📊 Kaynak Takibi:** Her projenin **CPU** ve **RAM** kullanımını anlık olarak izleyin.
* **👻 Dış Kaynak Tespiti:** Terminalden veya dışarıdan manuel başlattığınız projeleri otomatik algılar ve panele entegre eder.
* **🛠️ Kolay Kontrol:** Başlat, Durdur, Düzenle ve Sil işlemleri tek tıkla.
* **📥 Arka Plan Modu:** Sistem tepsisine (Tray) küçülerek arka planda çalışmaya devam eder.
* **🎨 Modern Arayüz:** Göz yormayan, şık Dark Mode tasarımı.

---

## 📂 Proje Yapısı

Proje dosyaları, bakımın kolay olması için modüler bir yapıda düzenlenmiştir:

```text
Node-Launcher/
├── main.js                  # Backend (Electron Ana Süreci)
├── package.json             # Bağımlılıklar ve Ayarlar
├── dist/                    # Derlenmiş .exe dosyaları (Build sonrası)
└── public/
    ├── index.html           # Arayüz (HTML Yapısı)
    ├── images/
    │   └── icon.png         # Uygulama Logosu
    └── src/
        ├── renderer.js      # Frontend Mantığı (UI Etkileşimleri)
        └── styles.css       # Tasarım ve Stiller
```
---

## 🚀 Kurulum ve Çalıştırma

Bu projeyi bilgisayarınızda geliştirmek veya çalıştırmak için şu adımları izleyin:

1. Projeyi Klonlayın
```bash
git clone https://github.com/KeremZayim/node-launcher.git
cd node-launcher
```
2. Bağımlılıkları Yükleyin
```bash
npm install
```
3. Uygulamayı Başlatın (Geliştirici Modu)
```bash
npm start
```
4. Windows İçin Kurulum Dosyası (.exe) Oluşturun

```bash
npm run dist
```
*Bu işlem `dist` klasörü içine `Node Launcher Setup.exe` dosyasını oluşturacaktır.*

---

## 🛠️ Kullanılan Teknolojiler

* **Electron:** Masaüstü uygulama çatısı.

* **Node.js:** Arka plan işlemleri.

* **HTML5 / CSS3:** Arayüz tasarımı.

* **Libraries:** pidusage (CPU/RAM takibi), systeminformation, electron-store (Veri kaydı).

---
## 🤝 Destek ve İletişim

Herhangi bir sorunla karşılaşırsanız veya öneriniz varsa, GitHub üzerinden Issue açmaktan çekinmeyin.

* **👤 Geliştirici:** Kerem Zayim

* **🌐 GitHub:** github.com/KeremZayim

Eğer bu projeyi beğendiyseniz, sağ üst köşeden bir **Yıldız (⭐)** bırakmayı unutmayın!

## ❤️ Teşekkürler

Bu projeyi geliştirirken ilham veren açık kaynak topluluğuna ve Node.js ekosistemine teşekkürler. Kullanıcı deneyimini en üst düzeye çıkarmak için geri bildirimleriniz benim için çok değerli.

--- 

Lisans: MIT License