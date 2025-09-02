Backend for portfolio — authentication microservice

Setup
- copy `.env.example` to `.env` and fill `MONGO_URI` with your connection string and `JWT_SECRET`.
- install deps: `npm install`
- seed the requested user (once): `node scripts/seedUser.js` (ensure `.env` is present)
- start server: `npm run dev` (needs `nodemon`) or `npm start`

Endpoints
- POST /api/auth/login { username, password } -> { token }
- GET /api/auth/private (Authorization: Bearer <token>) -> protected items
