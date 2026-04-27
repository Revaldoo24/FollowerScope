# API Documentation

Base URL (local): `http://localhost:3000`  
Content-Type: `application/json`

## Request Common Fields
- `sessionid` (opsional): cookie `sessionid` Instagram, dikirim via body request (bukan dari `.env`).
- Untuk endpoint followers: input menerima **username atau URL profil**.

Contoh:
```json
{
  "usernames": ["cristiano", "https://www.instagram.com/natgeo/"],
  "sessionid": "your_instagram_sessionid"
}
```

## 1) Instagram Followers
`POST /api/followers`

Deskripsi:
- Ambil followers profile Instagram.
- Mendukung input username dan URL profil.
- Return `biography` dan `url` (external link bio jika tersedia).

Request body:
```json
{
  "usernames": ["dollievu.____", "https://www.instagram.com/dollievu.____/"],
  "sessionid": "your_instagram_sessionid"
}
```

Response sukses (contoh):
```json
{
  "total": 1,
  "success": 1,
  "failed": 0,
  "sessionExpired": 0,
  "requiresSessionRefresh": false,
  "results": [
    {
      "status": "ok",
      "username": "dollievu.____",
      "fullName": "Berlian ??",
      "bio": "??:° ...",
      "biography": "??:° ...",
      "url": "https://pmb.stekom.ac.id/11726SMANEGERI1KRAMATTEGAL",
      "isPrivate": false,
      "isVerified": false,
      "followers": 975
    }
  ]
}
```

Validasi:
- minimal 1 input valid
- maksimal 50 item per request

## 2) TikTok Followers
`POST /api/tiktok/followers`

Deskripsi:
- Ambil followers profile TikTok.
- Mendukung input username dan URL profil.
- Diproses sequential (1 per 1).

Request body:
```json
{
  "usernames": ["khaby.lame", "https://www.tiktok.com/@tiktok"]
}
```

Response sukses (contoh):
```json
{
  "total": 1,
  "success": 1,
  "failed": 0,
  "results": [
    {
      "status": "ok",
      "username": "tiktok",
      "fullName": "TikTok",
      "bio": "...",
      "biography": "...",
      "url": "https://www.tiktok.com/@tiktok",
      "isPrivate": null,
      "isVerified": true,
      "followers": 93850545
    }
  ]
}
```

Validasi:
- minimal 1 input valid
- maksimal 50 item per request

## 3) Instagram Content Views
`POST /api/instagram/content-views`

Deskripsi:
- Ambil metrik konten Instagram (reel/video): `views`, `likes`, `comments`.
- Input bisa URL reel/post/video atau shortcode.
- `sessionid` sangat direkomendasikan untuk akurasi dan fallback GraphQL/DOM.

Request body:
```json
{
  "items": [
    "https://www.instagram.com/reel/DXXcutRkZv8/",
    "DXXcutRkZv8"
  ],
  "sessionid": "your_instagram_sessionid"
}
```

Response sukses (contoh):
```json
{
  "total": 1,
  "success": 1,
  "failed": 0,
  "sessionExpired": 0,
  "requiresSessionRefresh": false,
  "results": [
    {
      "status": "ok",
      "shortcode": "DXXcutRkZv8",
      "input": "https://www.instagram.com/reel/DXXcutRkZv8/",
      "url": "https://www.instagram.com/reel/DXXcutRkZv8/",
      "ownerUsername": "mrbubuyung",
      "views": 24759,
      "likes": 329,
      "comments": 2,
      "viewsAvailable": true
    }
  ]
}
```

Validasi:
- minimal 1 item valid
- maksimal 50 item per request

## 4) TikTok Content Views
`POST /api/tiktok/content-views`

Deskripsi:
- Ambil metrik video TikTok: `views`, `likes`, `comments`, `shares`.
- Input bisa URL video atau video ID.

Request body:
```json
{
  "items": [
    "https://www.tiktok.com/@scout2015/video/6718335390845095173",
    "6718335390845095173"
  ]
}
```

Response sukses (contoh):
```json
{
  "total": 1,
  "success": 1,
  "failed": 0,
  "results": [
    {
      "status": "ok",
      "input": "https://www.tiktok.com/@scout2015/video/6718335390845095173",
      "videoId": "6718335390845095173",
      "url": "https://www.tiktok.com/@scout2015/video/6718335390845095173",
      "username": "scout2015",
      "fullName": "Scout, Suki & Stella",
      "views": 157785,
      "likes": 35106,
      "comments": 5862,
      "shares": 1421,
      "title": "Scramble up ur name & I'll try to guess it"
    }
  ]
}
```

Validasi:
- minimal 1 item valid
- maksimal 50 item per request

## Error Format
Contoh error validasi:
```json
{
  "error": "Masukkan minimal 1 username valid."
}
```

Contoh partial error per item:
```json
{
  "status": "error",
  "code": "SESSION_EXPIRED",
  "input": "https://...",
  "message": "Session Instagram expired. Update sessionid lalu coba lagi."
}
```

## Environment Variables
`.env` yang dipakai:
```env
PORT=3000
```

Catatan:
- `INSTAGRAM_SESSIONID` tidak dipakai dari `.env`.
- Isi `sessionid` langsung dari frontend/request body jika dibutuhkan.

## Batasan
- Data bergantung pada ketersediaan publik dan perubahan struktur platform.
- Tanpa `sessionid`, beberapa data Instagram (terutama `biography`/`external_url`/views) bisa terbatas.
