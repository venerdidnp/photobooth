# Photobooth Dies Natalis HIMATIFA Level 6

Web app photobooth yang berjalan **lokal** di satu laptop dengan satu monitor eksternal. Tidak ada print dan tidak ada QR code.

- **Laptop** = panel operator di `/admin`.
- **Monitor eksternal** = tampilan tamu di `/booth` (hanya untuk dilihat, bukan touchscreen).
- Satu sesi = 3 foto. Strip portrait dirakit dari 3 foto + frame PNG, disimpan di laptop.
- Tamu mencari fotonya lewat nomor sesi, mis. `PHOTO #042.png`.

> **Status: Fase 1 selesai** (seluruh alur lokal tanpa Google Drive). Upload Drive, antrean retry, dan setup kredensial adalah **Fase 2** (belum dikerjakan). Halaman Queue dan panel Google Drive sudah ada di UI tetapi masih kosong/nonaktif.

## Kebutuhan

- Node.js 20 atau lebih baru (dites dengan Node 24) dan npm.
- Google Chrome atau Microsoft Edge (satu browser yang sama untuk `/admin` dan `/booth`).
- Webcam USB/bawaan.

## Menjalankan

```bash
npm install     # sekali saja (butuh internet saat ini)
npm start       # build frontend lalu jalankan server
```

Setelah menyala, server menampilkan dua alamat:

| Layar | Alamat |
|---|---|
| Operator (laptop) | http://localhost:3000/admin |
| Tamu (monitor eksternal) | http://localhost:3000/booth |

Setelah `npm install`, seluruh aplikasi berjalan **tanpa internet** (font dipasang lewat paket `@fontsource`, bukan CDN). Internet hanya dipakai untuk upload Drive (Fase 2) dan indikator ONLINE/OFFLINE.

Kalau repo ada di WSL: jalankan `npm start` di terminal WSL, lalu buka alamat di atas dari Chrome di Windows.

## Menyiapkan layar

1. Buka `/admin` di Chrome di laptop. Izinkan akses kamera.
2. Buka **jendela Chrome baru** (bukan tab baru) untuk `/booth`, seret ke monitor eksternal, lalu tekan **F11** untuk layar penuh.
   - **Harus jendela tersendiri.** Tab yang tidak sedang tampil di-pause oleh Chrome sehingga video webcam berhenti dan foto bisa hitam.
   - Pakai **profil Chrome yang sama** dengan `/admin` supaya pilihan kamera cocok dan kamera bisa dipakai dua jendela.
   - Jangan diminimalkan selama acara.
3. Di `/admin` pilih webcam dan frame. Indikator **BOOTH OK** di kanan atas harus hijau.
4. Tampilan tamu otomatis menyesuaikan resolusi monitor (kanvas 1920x1080 diskalakan dengan rasio tetap).

### Suara (opsional)

Browser menahan suara sampai ada interaksi di halaman. Pilih salah satu:

- Klik sekali di jendela `/booth` setelah dibuka, **atau**
- Buka `/booth` lewat shortcut Chrome dengan flag `--autoplay-policy=no-user-gesture-required`.

Suara bisa dimatikan di Settings.

## Alur operator

1. **MULAI**: tekan `SPACE` (atau tombol START SESSION). Tamu melihat READY, lalu hitung mundur 5 detik tiap foto, efek flash, jeda, dan seterusnya sampai 3 foto.
2. Strip dirakit otomatis dan tampil di layar tamu serta panel operator (**Review**).
3. Kalau ada yang mau diulang: pilih slot (boleh lebih dari satu) dengan tombol `1` `2` `3` atau tombol RETAKE di layar, lalu tekan `ENTER`. Hanya slot terpilih yang difoto ulang, lalu strip dirakit ulang. Bisa diulang berkali-kali.
4. **SELESAI**: `ENTER` (atau FINISH & UPLOAD) tanpa slot terpilih. Strip disimpan di laptop, lalu layar tamu menampilkan nomor foto.
5. Layar kembali ke awal, siap untuk tamu berikutnya.

### Pintasan keyboard (jendela `/admin` harus aktif)

| Tombol | Fungsi |
|---|---|
| `SPACE` | Mulai sesi (saat idle) |
| `1` `2` `3` | Pilih/batalkan slot untuk diulang (saat review) |
| `ENTER` | Mulai retake bila ada slot terpilih, kalau tidak: selesai |
| `ESC` dua kali | Batalkan sesi (ESC pertama hanya memperingatkan) |

## Latar layar tamu

Taruh gambar di **`public/bg/background.jpg`** (disarankan 1920x1080). Kalau file belum ada, layar tamu memakai gradien sunset sebagai cadangan. Setelah menaruh file, jalankan ulang `npm start` (atau `npm run build`) supaya ikut tersalin.

## Frame foto

Satu frame = sepasang file di folder `frames/`: `<nama>.png` (PNG transparan dengan lubang untuk foto) dan `<nama>.json`:

```json
{
  "name": "Sunset",
  "image": "sunset.png",
  "width": 800,
  "height": 2000,
  "slots": [
    { "x": 80, "y": 100,  "width": 640, "height": 480 },
    { "x": 80, "y": 640,  "width": 640, "height": 480 },
    { "x": 80, "y": 1180, "width": 640, "height": 480 }
  ]
}
```

- `width`/`height` = ukuran canvas strip (piksel), sama dengan ukuran PNG frame.
- `slots` = posisi dan ukuran tiap lubang foto. Jumlah slot = jumlah foto per sesi.
- `name` dan `image` opsional (default: nama file dan `<nama>.png`).
- Menambah frame baru **cukup menaruh PNG + JSON**, tanpa mengubah kode. Frame baru muncul di panel operator dalam beberapa detik. File yang tidak valid dilewati dan alasannya dicatat di log server.
- `frames/sunset.*` hanyalah **frame contoh untuk testing**. Buat ulang dengan `npm run make-frame`.

Foto diletakkan di slot dengan pemotongan tengah (cover), lalu PNG frame digambar di atasnya.

## Data lokal

```
data/
├─ counter.json           nomor sesi terakhir
├─ settings.json          pengaturan operator
└─ sessions/042/
   ├─ slot-1.jpg … slot-3.jpg   foto mentah per slot
   ├─ strip.png                 strip akhir
   └─ meta.json                 status sesi
```

- Nomor sesi berurutan (`001`, `002`, …) dan **tetap berlanjut setelah server restart**. Nomor berikutnya selalu `max(counter.json, folder terbesar) + 1`, jadi tidak pernah menimpa sesi lama walaupun `counter.json` hilang.
- Sesi yang dibatalkan tetap memakai nomornya (nomor tidak dipakai ulang).
- Folder `data/` berisi foto tamu dan **tidak masuk git**.

## Pengembangan

```bash
npm run dev         # server (watch) + Vite di http://localhost:5173
npm test            # unit test (state machine, penomoran, frame, settings)
npm run typecheck   # tsc --noEmit
```

Struktur:

```
server/src/   server Fastify + WebSocket, state machine sesi (session-machine.ts), penyimpanan
shared/       tipe & protokol bersama server dan frontend
web/src/      React + Vite: booth/ (layar tamu), admin/ (panel operator), components/, lib/, styles/
frames/       frame PNG + JSON
public/bg/    latar layar tamu
scripts/      pembuat frame contoh
```

### Cara kerja singkat

- **Server memegang state machine sesi** (`idle → ready → countdown → flash → between → … → review → saving → saved`). `/admin` dan `/booth` hanya menampilkan state yang dikirim lewat WebSocket (`/ws`) dan mengirim perintah operator.
- **`/booth` memegang webcam**: saat server memerintah `capture`, booth menjepret dan mengunggah foto lewat HTTP; saat `assemble`, booth merakit strip di canvas dan mengunggahnya.
- Kalau webcam terlepas di tengah acara, kamera dicoba dibuka lagi tiap 2 detik; foto yang gagal diulang otomatis (maks. 3 kali, lalu sesi dibatalkan dengan pesan di panel operator).

## Desain dan catatan keputusan

Desain mengikuti Figma (file `Hh1Y38fPNp2uUTZhEenZZr`): warna jadi CSS variables di `web/src/styles/tokens.css` (satu-satunya tempat hex), font Press Start 2P / Silkscreen / VT323 lewat `@fontsource`. Komponen `Button`, `StatusChip`, `Keycap`, `SlotBadge`, `ScenePhoto` mengikuti halaman "Components".

Keputusan yang diambil (bisa diubah):

- **Layar G9 "Offline"** = tidak ada internet saat sesi selesai: "PHOTO SAVED LOCALLY". Bukan layar kamera/WebSocket putus.
- **Gambar latar di Figma tidak dipakai** (itu gambar placeholder). Latar selalu `public/bg/background.jpg` dengan gradien sunset sebagai cadangan.
- **Retake multi-slot**: tombol RETAKE di O2 bersifat toggle. Saat ada slot terpilih muncul tombol "RETAKE n", dan FINISH dinonaktifkan sampai pilihan dikosongkan.
- **Layar hasil (G6–G9)** menampilkan strip yang sudah dirakit dengan frame, bukan tiga foto mentah seperti mockup.
- **Settings**: NUMBER OF SHOTS hanya tampilan (ditentukan jumlah slot frame). "Mirror live preview" membalik tampilan kamera di layar tamu seperti cermin; foto hasil tidak dibalik. Jeda antar foto default 5 detik mengikuti Figma.
- **Preview kamera di panel operator** dimatikan selama sesi supaya tidak berebut kamera dengan `/booth`.
- **Progress layar SAVING** menampilkan langkah penyimpanan yang sebenarnya (bukan persentase palsu).
- **Gallery** memakai foto asli sebagai thumbnail (belum ada thumbnail kecil di server); cukup untuk ratusan sesi di laptop, tetapi bisa diperbaiki bila terasa berat.
- Server hanya mendengarkan `127.0.0.1` (tidak terbuka ke jaringan). Ubah lewat `HOST` di `.env` bila perlu.

## Fase 2 (belum dikerjakan)

Upload otomatis ke Google Drive: antrean tersimpan di disk, worker latar belakang dengan retry dan exponential backoff, OAuth 2.0 (scope `drive.file`), script setup refresh token, dan panduan membuat kredensial di Google Cloud Console. Sesi yang selesai sebelum Fase 2 aktif akan dimasukkan ke antrean saat server menyala.
