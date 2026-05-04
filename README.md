# Smart Cart Saver

A modern grocery shopping app that helps you save money by tracking prices and comparing deals across stores.

## Features

- **Receipt Scanning**: Scan grocery receipts using AI-powered OCR with Claude API
- **Price Tracking**: Monitor price changes for your favorite items
- **Store Comparison**: Compare prices across different grocery stores
- **Shopping Lists**: Create and manage shopping lists
- **Offline Support**: Works offline with OCR fallback

## Setup

### Prerequisites

- Node.js 18+
- npm or bun
- MongoDB Atlas account (for backend)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   cd backend && npm install
   ```

3. **Set up Claude API (Recommended)**:
   - Get your API key from [Anthropic Console](https://console.anthropic.com/)
   - Add it to `.env`:
     ```
     VITE_CLAUDE_API_KEY=your_actual_api_key_here
     ```

4. **Backend Setup**:
   - Copy `backend/.env` and update:
     - `MONGODB_URI`: Your MongoDB Atlas connection string
     - `JWT_SECRET`: Random secret key for JWT tokens
     - `EMAIL_*`: Gmail SMTP settings for email notifications
     - `TWILIO_*`: Twilio credentials for SMS notifications
     - `APP_URL`: Frontend application URL for email links
   - Start backend: `cd backend && npm run dev`

### Notification Services
The app sends welcome notifications on successful registration:

**SMS Format:**
```
Hi, you are successfully registered for SmartBasket.
Enjoy shopping!

Thank you
Team SmartBasket
```

**Email Format:**
```
Hi,

You are successfully registered for SmartBasket.
Enjoy shopping!

Link to SmartBasket web application

Thank you
Team SmartBasket
```

#### Email Setup (Gmail):
1. Enable 2-factor authentication on your Gmail account
2. Generate an App Password: https://support.google.com/accounts/answer/185833
3. Use your Gmail address as `EMAIL_USER`
4. Use the App Password as `EMAIL_PASS`

#### SMS Setup (Twilio):
1. Create a Twilio account: https://www.twilio.com/
2. Get your Account SID and Auth Token from the dashboard
3. Purchase a phone number for sending SMS
4. Configure the environment variables

5. **Frontend Setup**:
   - Start frontend: `npm run dev`

### Receipt Scanning

The app uses AI-powered receipt data extraction:

- **Primary**: Claude 3.5 Sonnet for accurate text recognition and structured data extraction
- **Fallback**: Tesseract.js OCR for offline scenarios
- **Read-Only**: Scanned data cannot be edited - ensuring data integrity
- **Auto-Save**: Extracted items are automatically saved to the price database
- **Smart Messages**: Shows "Scanning using Claude..." or "Processing with OCR..." based on method used

### Features:
- Extracts store name, location, zip code
- Identifies all grocery items with quantities and prices
- Calculates unit prices automatically
- Saves price history for price tracking
- Visual progress indicators during scanning

### API Keys

- **Claude API**: For AI-powered receipt scanning (optional but recommended)
- **Google Maps**: For store location features
- **MongoDB Atlas**: For data storage

## Development

```bash
# Frontend
npm run dev

# Backend
cd backend && npm run dev

# Build for production
npm run build
```

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, Shadcn/ui
- **Backend**: Node.js, Express, MongoDB, JWT
- **AI**: Anthropic Claude API for receipt processing
- **OCR**: Tesseract.js (fallback)
- **Maps**: Google Maps API
