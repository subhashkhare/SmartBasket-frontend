# Smart Cart Saver - Full Stack Integration

## Overview

Smart Cart Saver is a Progressive Web App (PWA) for grocery price comparison and route optimization. This document outlines the complete full-stack implementation with a Node.js backend, MongoDB Atlas cloud database, and React frontend with authentication.

## Architecture

### Frontend (React + TypeScript)
- **Framework**: React 18 with TypeScript
- **UI Library**: Tailwind CSS + shadcn/ui components
- **Routing**: React Router
- **State Management**: React Query for API state
- **PWA**: VitePWA plugin for offline functionality
- **Maps Integration**: Google Maps API for routing and store locations

### Backend (Node.js + Express)
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB Atlas (cloud)
- **Authentication**: JWT tokens with bcryptjs password hashing
- **CORS**: Enabled for cross-origin requests

### Database (MongoDB Atlas)
- **Users**: Phone number and PIN authentication
- **Stores**: Store locations with geospatial data
- **Prices**: Item prices by store

## Setup Instructions

### Prerequisites
- Node.js 18+
- npm or bun
- MongoDB Atlas account
- Google Maps API key (for maps functionality)

### Backend Setup

1. **Navigate to backend directory**:
   ```bash
   cd smart-cart-saver/backend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Environment Configuration**:
   Create a `.env` file in the backend directory:
   ```env
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/smart_cart_saver
   JWT_SECRET=your_super_secret_jwt_key_here
   PORT=5000
   ```

4. **Seed the database** (optional):
   ```bash
   npm run seed
   ```

5. **Start the backend server**:
   ```bash
   npm run dev
   ```

### Frontend Setup

1. **Navigate to frontend directory**:
   ```bash
   cd smart-cart-saver
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Build for production**:
   ```bash
   npm run build
   ```

## API Documentation

### Authentication Endpoints

#### POST /api/auth/register
Register a new user with phone number and PIN.

**Request Body**:
```json
{
  "phoneNumber": "1234567890",
  "pin": "1234",
  "preferredStore": "Walmart",
  "zipCode": "90210"
}
```

**Response**:
```json
{
  "token": "jwt_token_here",
  "user": {
    "id": "user_id",
    "phoneNumber": "1234567890",
    "preferredStore": "Walmart",
    "zipCode": "90210"
  }
}
```

#### POST /api/auth/login
Login with phone number and PIN.

**Request Body**:
```json
{
  "phoneNumber": "1234567890",
  "pin": "1234"
}
```

**Response**: Same as register response.

### Store Endpoints

#### GET /api/stores
Get all stores.

**Response**:
```json
[
  {
    "_id": "store_id",
    "name": "Walmart Supercenter",
    "address": "123 Main St, Anytown, USA",
    "location": {
      "type": "Point",
      "coordinates": [-74.006, 40.7128]
    },
    "zipCode": "10001"
  }
]
```

#### GET /api/stores/:id
Get a specific store by ID.

#### POST /api/stores (Authenticated)
Create a new store.

#### PUT /api/stores/:id (Authenticated)
Update a store.

#### DELETE /api/stores/:id (Authenticated)
Delete a store.

### Price Endpoints

#### GET /api/prices
Get all prices with populated store data.

**Response**:
```json
[
  {
    "_id": "price_id",
    "itemName": "Milk",
    "price": 3.49,
    "store": {
      "_id": "store_id",
      "name": "Walmart Supercenter",
      "address": "123 Main St, Anytown, USA",
      "location": { "type": "Point", "coordinates": [-74.006, 40.7128] },
      "zipCode": "10001"
    }
  }
]
```

#### GET /api/prices/store/:storeId
Get prices for a specific store.

#### POST /api/prices (Authenticated)
Create a new price entry.

#### PUT /api/prices/:id (Authenticated)
Update a price entry.

#### DELETE /api/prices/:id (Authenticated)
Delete a price entry.

## Database Schema

### User Model
```javascript
{
  phoneNumber: { type: String, required: true, unique: true },
  pin: { type: String, required: true }, // Hashed with bcryptjs
  preferredStore: { type: String },
  zipCode: { type: String }
}
```

### Store Model
```javascript
{
  name: { type: String, required: true },
  address: { type: String, required: true },
  location: {
    type: { type: String, default: 'Point' },
    coordinates: [Number] // [longitude, latitude]
  },
  zipCode: { type: String, required: true }
}
```

### Price Model
```javascript
{
  itemName: { type: String, required: true },
  price: { type: Number, required: true },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  observedAt: { type: Date, default: Date.now }
}
```

## Authentication Flow

1. **Registration/Login**: User provides phone number and 4-digit PIN
2. **Token Generation**: Server generates JWT token upon successful authentication
3. **Token Storage**: Token stored in localStorage on frontend
4. **API Requests**: Token included in Authorization header for authenticated requests
5. **Token Verification**: Server middleware verifies token on protected routes

## Auto-Approval Rules

Registration requests are automatically approved only when all rules pass.

### Rule Set (Current)
- `phoneNumber` must normalize to a valid US 10-digit number.
- `email` must be a valid email format and is normalized to lowercase.
- `pin` must be exactly 4 digits.
- `zipCode` is optional; when provided it must be `12345` or `12345-6789`.
- `phoneNumber` and `email` must be unique in the user collection.

### Approval Outcomes
- If all rules pass: user is created, PIN is hashed, and a JWT token is returned.
- If any rule fails: request is rejected with HTTP 400 and rule-specific message.

### Runtime Source of Truth
- Backend policy evaluator: `backend/lib/registrationPolicy.js`
- Policy usage in auth routes: `backend/routes/auth.js`

## Frontend Integration

### API Service (`src/lib/api.ts`)
Centralized API service handling authentication, token management, and HTTP requests.

### Authentication State
- App checks for JWT token on load
- Routes protected based on authentication status
- AuthPage handles login/registration

### Data Fetching
- React Query used for API state management
- API responses cached and synchronized
- Error handling with user-friendly messages

## PWA Features

- **Service Worker**: Automatic caching for offline functionality
- **Web App Manifest**: Installable on mobile devices
- **Responsive Design**: Works on all screen sizes
- **Fast Loading**: Optimized with Vite build system

## Deployment

### Backend Deployment
- Deploy to services like Heroku, Railway, or Vercel
- Ensure environment variables are set
- Database connection string should point to MongoDB Atlas

### Frontend Deployment
- Build with `npm run build`
- Deploy to Netlify, Vercel, or any static hosting service
- Configure API base URL for production

## Security Considerations

- **Password Hashing**: PINs hashed with bcryptjs
- **JWT Tokens**: Secure token-based authentication
- **CORS**: Properly configured for cross-origin requests
- **Input Validation**: Server-side validation on all endpoints
- **Rate Limiting**: Consider implementing rate limiting for production

## Future Enhancements

- **Receipt Scanning**: OCR integration for automatic price entry
- **Real-time Prices**: WebSocket updates for price changes
- **User Preferences**: Personalized shopping recommendations
- **Social Features**: Share shopping lists with family
- **Analytics**: Spending insights and trends

## Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**
   - Check MongoDB Atlas connection string
   - Ensure IP whitelist includes your IP
   - Verify database user credentials

2. **CORS Errors**
   - Backend CORS configuration allows frontend origin
   - Check if backend is running on correct port

3. **Authentication Issues**
   - Verify JWT_SECRET is set
   - Check token expiration (7 days)
   - Ensure token is sent in Authorization header

4. **PWA Not Installing**
   - Serve over HTTPS in production
   - Check web app manifest configuration
   - Verify service worker registration

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with proper TypeScript types
4. Test both frontend and backend
5. Submit a pull request

## License

This project is licensed under the MIT License.