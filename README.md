# Offerly Backend

REST API for job application management.

## Description

Offerly is a backend application that allows users to manage their job applications, keep track of companies they've applied to, application status, and other relevant information.

## Features

- User authentication with JWT
- Full CRUD for job applications
- Application status management (applied, interview, offer, rejected)
- Authentication middleware
- MongoDB database
- Unit tests with Jest

## Technologies

- Node.js
- TypeScript
- Express.js
- MongoDB with Mongoose
- JWT for authentication
- bcrypt for password hashing
- Jest for testing

## Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Create `.env` file with the following variables:

```
PORT=3000
DB_URI=mongodb://localhost:27017/offerly
JWT_SECRET=your_jwt_secret
CORS_ORIGIN=http://localhost:3000
```

## Usage

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

### Tests

```bash
npm test
```

## Endpoints

### Authentication

- `POST /api/auth/register` - Register user
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout

### Applications

- `GET /api/applications` - Get user applications
- `POST /api/applications` - Create new application
- `PATCH /api/applications/:id` - Edit application
- `DELETE /api/applications/:id` - Delete application

## Project Structure

```
src/
├── config/          # Configurations (DB, Jest)
├── controller/      # Controllers
├── middleware/      # Middlewares (Auth)
├── models/          # MongoDB Models
├── routes/          # API Routes
├── __tests__/       # Unit tests
├── app.ts           # Express configuration
└── index.ts         # Entry point
```

## Application Status

- `applied` - Application submitted
- `interview` - Interview process
- `offer` - Offer received
- `rejected` - Application rejected

## Application Model

```typescript
{
  company: string; // Company name
  position: string; // Applied position
  status: string; // Application status
  location: string; // Job location
  salary: number; // Offered salary
  currency: string; // Salary currency
  jobUrl: string; // Job URL
  description: string; // Job description
  appliedAt: Date; // Application date
  notes: string; // Additional notes
}
```
