# Aturan Git untuk Claude

Proyek: Photobooth "Dies Natalis HIMATIFA Level 6".

## Commit
- Boleh membuat commit lokal, tapi hanya setelah satu unit kerja selesai dan tesnya lolos. Jangan commit kode yang masih rusak.
- Satu commit = satu perubahan yang jelas. Pesan commit singkat, bahasa Indonesia atau Inggris, bentuk imperatif (contoh: "Tambah state machine sesi foto").
- Sebelum commit, jalankan `git status` dan `git diff --staged`. Stage file satu per satu, jangan pakai `git add -A` atau `git add .` kalau belum dicek.
- Jangan pernah commit file rahasia: `.env`, token OAuth, `credentials.json`, `client_secret*.json`, isi folder `data/` (foto tamu), dan `node_modules/`. Pastikan semuanya ada di `.gitignore`.

## Atribusi (penting)
- Pesan commit TIDAK BOLEH memuat baris `Co-Authored-By:` atau trailer apa pun yang menyebut Claude, Anthropic, atau AI.
- Jangan menambahkan teks seperti "Generated with Claude Code", tautan sesi, atau tanda tangan sejenis, baik di pesan commit, deskripsi PR, kode, komentar, maupun README.
- Jangan mengubah `git config` (user.name, user.email). Semua commit memakai identitas pemilik repo apa adanya.
- Tujuannya: Claude tidak tercatat sebagai contributor di riwayat repo maupun di GitHub.

## Dilarang tanpa izin eksplisit dariku
- `git push` dalam bentuk apa pun (termasuk `--force`, `--tags`, `push --set-upstream`). Aku yang push sendiri.
- Membuat atau mengubah remote, membuat pull request, atau menjalankan perintah `gh` yang menulis ke GitHub.
- Operasi yang menulis ulang riwayat: `git commit --amend`, `git rebase`, `git reset --hard`, `git filter-branch`, `git push --force`.
- Menghapus branch atau tag, dan `git clean -fd`.

## Kalau ragu
Berhenti dan tanya. Setelah selesai commit, cukup beri tahu aku hash dan pesan commitnya. Aku yang memutuskan kapan dan ke mana di-push.