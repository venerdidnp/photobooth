# Photobooth Dies Natalis Informatika ke-6

Web app photobooth yang berjalan **lokal** di satu laptop dengan satu monitor eksternal. Tidak ada print dan tidak ada QR code.

- **Laptop** = panel operator di `/admin`.
- **Monitor eksternal** = tampilan tamu di `/booth` (hanya untuk dilihat, bukan touchscreen).
- Satu sesi = jumlah foto sesuai slot frame (frame bawaan: 4 foto). Strip portrait dirakit dari foto + frame PNG, disimpan di laptop.
- Tamu mencari fotonya lewat nomor sesi, mis. `PHOTO #042.png`.

> **Status:** alur lokal lengkap (Fase 1) dan upload otomatis ke Google Drive dengan antrean + retry (Fase 2) sudah selesai. Upload Drive **baru diuji terhadap server Google tiruan**, belum terhadap Google asli. Lakukan uji coba nyata dulu sebelum hari acara (lihat "Hari acara").
>
> Drive bersifat opsional: tanpa kredensial, aplikasi tetap berjalan penuh dan strip tersimpan di laptop; strip akan masuk antrean dan terupload setelah Drive disiapkan.

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

Setelah `npm install`, seluruh aplikasi berjalan **tanpa internet** (tidak ada CDN; font memakai Inter bila terpasang di komputer, kalau tidak otomatis font sistem). Internet hanya dipakai untuk upload Drive (Fase 2) dan indikator ONLINE/OFFLINE.

Kalau repo ada di WSL: jalankan `npm start` di terminal WSL, lalu buka alamat di atas dari Chrome di Windows.

## Menyiapkan layar

1. Buka `/admin` di Chrome di laptop. Izinkan akses kamera.
2. Buka **jendela Chrome baru** (bukan tab baru) untuk `/booth`, seret ke monitor eksternal, lalu tekan **F11** untuk layar penuh.
   - **Harus jendela tersendiri.** Tab yang tidak sedang tampil di-pause oleh Chrome sehingga video webcam berhenti dan foto bisa hitam.
   - Pakai **profil Chrome yang sama** dengan `/admin` supaya pilihan kamera cocok dan kamera bisa dipakai dua jendela.
   - Jangan diminimalkan selama acara.
3. Di `/admin` pilih webcam dan frame. Chip **Layar Tamu: Tersambung** di header harus hijau.
4. Tampilan tamu otomatis menyesuaikan resolusi monitor (kanvas 1920x1080 diskalakan dengan rasio tetap).

### Suara (opsional)

Browser menahan suara sampai ada interaksi di halaman. Pilih salah satu:

- Klik sekali di jendela `/booth` setelah dibuka, **atau**
- Buka `/booth` lewat shortcut Chrome dengan flag `--autoplay-policy=no-user-gesture-required`.

Suara bisa dimatikan di Settings.

## Alur operator

1. **MULAI**: tekan `SPASI` (atau tombol **Mulai 4 Pose**). Tamu melihat "Siap?", lalu hitung mundur tiap foto, efek flash, jeda, dan seterusnya sampai semua pose selesai.
2. Strip dirakit otomatis dan tampil di layar tamu, dan panel operator masuk mode review.
3. Kalau ada yang mau diulang: pilih pose (boleh lebih dari satu) dengan tombol angka `1`-`4` atau tombol **Ulangi** di kartu pose, lalu tekan `ENTER` (atau **Ulangi Pose**). Hanya slot terpilih yang difoto ulang, lalu strip dirakit ulang. Bisa diulang berkali-kali.
4. **SELESAI**: `ENTER` (atau **Simpan & Upload**) tanpa pose terpilih. Strip disimpan di laptop, lalu layar tamu menampilkan nomor foto.
5. Layar kembali ke awal, siap untuk tamu berikutnya.

### Pintasan keyboard (jendela `/admin` harus aktif)

| Tombol | Fungsi |
|---|---|
| `SPASI` | Mulai sesi (saat idle) |
| `1` - `4` | Pilih/batalkan pose untuk diulang (saat review) |
| `ENTER` | Mulai retake bila ada pose terpilih, kalau tidak: selesai |
| `ESC` dua kali | Batalkan sesi (ESC pertama hanya memperingatkan) |

## Menyiapkan Google Drive

Setelah **SELESAI**, strip disimpan di laptop lalu masuk antrean upload yang disimpan di disk (`data/upload-queue.json`). Worker di latar belakang mengupload satu per satu dengan retry dan exponential backoff, jadi sesi foto berikutnya tidak pernah menunggu upload. Tamu mencari fotonya dengan nama file `PHOTO #042.png` di folder Drive bersama.

Dilakukan **sekali** (± 10 menit, butuh internet):

### 1. Membuat kredensial di Google Cloud Console

1. Buka https://console.cloud.google.com dan login dengan akun Google panitia (yang akan memiliki foto-foto ini).
2. Buat proyek baru (menu pemilih proyek di atas, **New Project**), mis. `photobooth-informatika`.
3. **APIs & Services → Library**, cari **Google Drive API**, klik **Enable**.
4. **APIs & Services → OAuth consent screen** (di tampilan baru: **Google Auth Platform**):
   - User type: **External**. Isi nama aplikasi (mis. `Photobooth`), email dukungan, dan email kontak developer.
   - **Scopes** (Data Access): tambahkan hanya `.../auth/drive.file`.
   - **Publishing status: ubah ke "In production"** (tombol *Publish app*). **Ini penting.** Selama statusnya *Testing*, token login Google kedaluwarsa dalam **7 hari** sehingga upload tiba-tiba berhenti. Scope `drive.file` tidak sensitif, jadi tidak perlu verifikasi Google untuk pemakaian pribadi. Kalau muncul peringatan "app belum diverifikasi" saat login, klik *Advanced → Go to … (unsafe)*; itu aplikasi Anda sendiri.
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app**, beri nama bebas, **Create**.
   - Salin **Client ID** dan **Client secret**.
6. Salin `.env.example` menjadi `.env` dan isi:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```

### 2. Login dan buat folder tujuan

```bash
npm run drive:setup -- --create-folder "Photobooth Informatika 6"
```

- Script mencetak sebuah alamat. **Buka di browser**, login dengan akun panitia, dan setujui akses. (Di WSL alamat itu dibuka dari Chrome di Windows; pengalihan ke `127.0.0.1` otomatis sampai ke script.)
- Token login (refresh token) tersimpan di `data/google-token.json` (tidak masuk git). Scope hanya `drive.file`.
- Script membuat folder dan menyimpan ID-nya di `data/drive-folder.json`.
- Buka folder itu di drive.google.com → **Share** → *Anyone with the link: Viewer*, lalu bagikan link-nya ke tamu (mis. di poster/media sosial acara). Tamu cukup mencari `PHOTO #042`.

**Kenapa folder dibuat oleh aplikasi?** Dengan izin `drive.file`, aplikasi hanya boleh menyentuh file dan folder yang ia buat sendiri; folder yang sudah ada biasanya ditolak Google ("File not found"). Kalau tetap ingin memakai folder yang sudah ada, isi `DRIVE_FOLDER_ID` di `.env` lalu jalankan `npm run drive:setup`; bila folder tidak bisa diakses, script akan memberi tahu dan Anda cukup memakai `--create-folder`. *Bagian ini belum teruji terhadap Google asli.*

Perintah lain: `npm run drive:setup -- --reauth` (login ulang bila token dicabut).

### 3. Pastikan jalan

Jalankan `npm start`. Di log server harus muncul `Google Drive: terkonfigurasi`. Di `/admin` → **Pengaturan**, panel *Google Drive* harus menampilkan `Terhubung`, akun, dan nama folder, dan chip di header menjadi **Drive OK**. Lakukan satu sesi percobaan dan pastikan `PHOTO #001.png` muncul di folder Drive.

### Cara kerja antrean

| Kejadian | Perlakuan |
|---|---|
| Internet mati / timeout | Tetap **Antre**, dicoba lagi dengan jeda 2, 4, 8, 16, 30 detik (maks. 30 dtk). **Tidak pernah dianggap gagal**; saat internet kembali, langsung dicoba sekarang. Layar tamu memakai tampilan "Foto Tersimpan di Laptop". |
| Google error sementara (429/5xx) | Backoff 5 dtk hingga 5 menit; **FAILED** setelah 8 percobaan. |
| Token dicabut/kedaluwarsa, folder tidak bisa diakses, dll. | Langsung **FAILED** dengan pesan di halaman Queue dan chip **DRIVE ERROR**. Perbaiki (mis. `npm run drive:setup -- --reauth`), lalu tekan **RETRY**. |
| Server mati/restart | Antrean tersimpan di disk; item yang sedang diupload kembali ke Antre dan lanjut otomatis. Sesi selesai yang belum pernah masuk antrean ikut dimasukkan saat server menyala. |
| Upload diulang setelah balasan hilang | Tidak ada file ganda: setiap upload membawa kunci unik sesi dan Drive dicek dulu. |

Catatan:
- Nama file di Drive adalah `PHOTO #<nomor>.png`. Pakai **folder baru untuk tiap acara**; kalau nomor sesi dimulai dari 001 lagi di folder yang sama, Drive akan berisi dua file bernama sama.
- Panel Settings: **CHANGE FOLDER** (tempel link/ID folder yang dibuat aplikasi) dan **DISCONNECT** (hapus token; sambungkan lagi dengan `drive:setup`).
- Progress upload per-byte tidak ditampilkan (file dikirim sekaligus); item yang sedang diupload tampil setengah penuh.

## Tampilan

- **/admin** (laptop operator): tema terang minimalis (font Inter), responsif. Halaman **Kontrol** (preview monitor, slot pose + retake, riwayat sesi, kamera & pengaturan sesi, frame), **Antrean Upload**, dan **Pengaturan** (Google Drive + lokasi penyimpanan). Tombol **Buka Layar Tamu** di header membuka `/booth` di jendela baru.
- **/booth** (monitor tamu): tema gelap, pasif, tanpa elemen interaktif. Tidak ada lagi gambar latar `public/bg/background.jpg`.
- **Kamera simulasi**: kalau tidak ada webcam (atau untuk uji coba), pilih *Kamera simulasi* di panel Kamera & Sesi. Layar tamu ikut memakainya.

## Frame foto

Satu frame = sepasang file di folder `frames/`: `<nama>.png` (PNG transparan dengan lubang untuk foto) dan `<nama>.json`:

```json
{
  "name": "Dies Natalis Informatika",
  "image": "dies-natalis.png",
  "width": 1080,
  "height": 1920,
  "slots": [
    { "x": 274, "y": 307,  "width": 535, "height": 300 },
    { "x": 274, "y": 640,  "width": 535, "height": 300 },
    { "x": 274, "y": 973,  "width": 535, "height": 300 },
    { "x": 274, "y": 1306, "width": 535, "height": 300 }
  ]
}
```

- `width`/`height` = ukuran canvas strip (piksel), sama dengan ukuran PNG frame.
- `slots` = posisi dan ukuran tiap lubang foto. Jumlah slot = jumlah foto per sesi.
- `name` dan `image` opsional (default: nama file dan `<nama>.png`).
- Menambah frame baru **cukup menaruh PNG + JSON**, tanpa mengubah kode. Frame baru muncul di panel operator dalam beberapa detik. File yang tidak valid dilewati dan alasannya dicatat di log server.
- Frame bawaan hanya satu: `frames/dies-natalis.*` (strip 4 foto, 1080x1920).

Foto diletakkan di slot dengan pemotongan tengah (cover), lalu PNG frame digambar di atasnya.

## Data lokal

```
data/
├─ counter.json           nomor sesi terakhir
├─ settings.json          pengaturan operator
├─ upload-queue.json      antrean upload Drive
├─ google-token.json      token login Google (RAHASIA)
├─ drive-folder.json      ID folder Drive tujuan
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
scripts/      setup Google Drive (drive-setup.ts)
```

### Cara kerja singkat

- **Server memegang state machine sesi** (`idle → ready → countdown → flash → between → … → review → saving → saved`). `/admin` dan `/booth` hanya menampilkan state yang dikirim lewat WebSocket (`/ws`) dan mengirim perintah operator.
- **`/booth` memegang webcam**: saat server memerintah `capture`, booth menjepret dan mengunggah foto lewat HTTP; saat `assemble`, booth merakit strip di canvas dan mengunggahnya.
- Kalau webcam terlepas di tengah acara, kamera dicoba dibuka lagi tiap 2 detik; foto yang gagal diulang otomatis (maks. 3 kali, lalu sesi dibatalkan dengan pesan di panel operator).

## Desain dan catatan keputusan

Desain mengikuti `photobooth_dies_natalis_himatifa_level_6.html` (operator terang + layar tamu gelap): warna jadi CSS variables di `web/src/styles/tokens.css` (satu-satunya tempat hex). Teks acara memakai "Dies Natalis Informatika ke-6".

Keputusan yang diambil (bisa diubah):

- **Layar "Offline"** = tidak ada internet saat sesi selesai: "Foto Tersimpan di Laptop". Bukan layar kamera/WebSocket putus.
- **Retake multi-pose**: tombol **Ulangi** di kartu pose bersifat toggle. Saat ada pose terpilih muncul tombol **Ulangi Pose n**, dan **Simpan & Upload** dinonaktifkan sampai pilihan dikosongkan.
- **Layar hasil** menampilkan strip yang sudah dirakit dengan frame, bukan foto mentah.
- **Pengaturan sesi** (hitung mundur, jeda, mirror, suara, flash) ada di kartu *Kamera & Sesi* di halaman Kontrol. Jumlah pose ditentukan jumlah slot frame. Mirror membalik tampilan kamera di layar tamu seperti cermin; foto hasil tidak dibalik.
- **Preview kamera di panel operator** dimatikan selama sesi supaya tidak berebut kamera dengan `/booth`.
- **Progres layar Menyimpan** menampilkan langkah penyimpanan yang sebenarnya (bukan persentase palsu).
- **Riwayat Sesi** memakai `strip.png` asli sebagai thumbnail (belum ada thumbnail kecil di server); cukup untuk puluhan sesi terakhir (40 ditampilkan). Klik untuk membuka strip penuh dan mengunduhnya.
- Server hanya mendengarkan `127.0.0.1` (tidak terbuka ke jaringan). Ubah lewat `HOST` di `.env` bila perlu.

## Hari acara

**Sehari sebelumnya (butuh internet):**
1. `npm install` dan `npm start` sekali; pastikan tidak ada error.
2. Siapkan Drive (bagian di atas) dan lakukan **satu sesi percobaan penuh**: `PHOTO #001.png` harus muncul di folder Drive dan `/admin` menunjukkan **Drive OK**.
3. Pastikan frame asli ada di `frames/` (PNG + JSON).
4. Hapus data percobaan supaya nomor mulai dari 001: hentikan server, hapus isi folder `data/` **kecuali** `google-token.json` dan `drive-folder.json`. Dan pakai folder Drive baru bila folder percobaan sudah berisi foto.
5. Uji dengan Wi-Fi dimatikan: selesaikan satu sesi, layar tamu harus menampilkan "Foto Tersimpan di Laptop", lalu nyalakan Wi-Fi dan lihat strip terupload sendiri.

**Saat acara:**
1. Colok webcam dan monitor eksternal, lalu `npm start` di folder proyek.
2. Chrome: `/admin` di laptop; **jendela baru** `/booth` diseret ke monitor eksternal, F11 (klik sekali di dalamnya bila ingin suara).
3. Di `/admin` periksa chip di header: **Layar Tamu: Tersambung**, **Online**, **Drive OK**; pilih webcam dan frame.
4. Tekan `SPASI` untuk tiap tamu. Selesaikan dengan `ENTER`. Tamu mencari `PHOTO #nomor` di folder Drive.
5. Pantau halaman **Antrean Upload**: bila ada **Gagal**, baca pesannya, perbaiki, lalu **Coba Lagi**.

**Bila ada masalah:**
- *Layar Tamu: Belum Dibuka*: pastikan jendela `/booth` terbuka (bukan tab latar belakang) dan tidak diminimalkan.
- *Layar hitam di viewfinder*: webcam terlepas; cabut-colok. Aplikasi mencoba membukanya lagi tiap 2 detik.
- *DRIVE ERROR*: baca pesan di Pengaturan atau Antrean Upload. Token dicabut → `npm run drive:setup -- --reauth` lalu Coba Lagi.
- *Server mati*: jalankan `npm start` lagi. Foto, nomor sesi, dan antrean upload semuanya selamat.
- *Cadangan terakhir*: semua foto ada di `data/sessions/<nomor>/strip.png` dan bisa disalin manual.

Variabel `GOOGLE_API_BASE`, `GOOGLE_UPLOAD_BASE`, `GOOGLE_TOKEN_URL`, dan `CONNECTIVITY_URL` hanya untuk pengujian (server Google tiruan); jangan diisi di acara sebenarnya.
