# Beet House Cup — Backend API

Node.js + Express + PostgreSQL backend for the Beet House Cup school gamification app.

## Stack
- **Runtime:** Node.js
- **Framework:** Express
- **Database:** PostgreSQL (Railway)
- **Auth:** JWT (7-day tokens) + bcrypt password hashing

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (auto-set by Railway) |
| `JWT_SECRET` | Long random string for signing tokens |
| `ADMIN_PASSWORD` | Initial admin password (default: admin123) |
| `PORT` | Port (auto-set by Railway) |

## API Reference

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | None | Login, returns `{ token, user }` |
| POST | `/auth/change-password` | Token | Change password, returns new `{ token, user }` |

### Users
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/users` | Admin | All users |
| GET | `/api/users/me` | Any | Current user |
| GET | `/api/users/students` | Teacher+ | All students |
| GET | `/api/users/house-totals` | Any | Points per house |
| PATCH | `/api/users/:id` | Admin | Update user |
| POST | `/api/users/import/students` | Admin | Bulk import students |
| POST | `/api/users/import/teachers` | Admin | Bulk import teachers |

### Transactions
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/transactions` | Any | All (teacher+) or own (student) |
| POST | `/api/transactions` | Teacher+ | Award/deduct points |
| DELETE | `/api/transactions/:id` | Admin | Undo transaction |

### Purchases
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/purchases` | Any | All (teacher+) or own (student) |
| POST | `/api/purchases` | Any | Redeem store item |

### Tasks
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/tasks` | Any | All tasks |
| PATCH | `/api/tasks/:id` | Teacher+ | Update task |
| DELETE | `/api/tasks/:id` | Admin | Delete task |
| POST | `/api/tasks/import` | Admin | Bulk import tasks |

## Deploy to Railway

1. Push this repo to GitHub
2. New Railway project → Deploy from GitHub repo
3. Add PostgreSQL plugin
4. Set environment variables: `JWT_SECRET`, `ADMIN_PASSWORD`
5. Railway auto-deploys on every push to main
