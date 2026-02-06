# Vote Events Feature

## Overview
The Vote Events feature allows server owners to create interactive voting contests where participants vote on images and winners are automatically determined and paid.

## Key Features

### Server Owner Restrictions
- **IMPORTANT**: Only the server owner can create vote events (and contests/tasks)
- This ensures proper control and prevents abuse

### Vote Event Creation
- Upload 2-5 images as part of the event
- Each image gets an auto-generated ID (e.g., `IMG-1234567890-abc123def-1`)
- Set minimum and maximum participant limits
- Optional prize pool (split evenly among winners)
- Optional timer (in minutes)
- Server owner can privately select a favorite image (hidden from participants)

### Participant Experience
1. **Join the Event**: Click "🎫 Join Event" button (requires connected wallet)
2. **Vote**: Use the dropdown menu to select favorite image
3. **Wait for Results**: Vote is final and cannot be changed

### Winner Determination
- **If owner picked favorite**: Winners are participants who voted for the same image
- **If owner didn't pick**: Winners are participants who voted for the most popular image
- Prize is split evenly among all winners

### Automated Features
- Event ends automatically when timer expires
- Minimum participant check (event cancelled if not met)
- Automated SOL payouts from guild treasury
- Results announcement with vote percentages and payment verification

## Commands

### `/vote-event create`
Create a new voting event

**Required Parameters:**
- `title`: Event title
- `description`: Event description
- `min_participants`: Minimum participants to start (2-100)
- `max_participants`: Maximum participants allowed (2-1000)
- `image1`: First image
- `image2`: Second image

**Optional Parameters:**
- `image3`, `image4`, `image5`: Additional images
- `prize_amount`: Prize pool amount
- `currency`: Prize currency (SOL or USD)
- `duration_minutes`: Event duration in minutes (1-10080)
- `favorite_image_id`: Your private favorite image ID (kept secret)

**Example:**
```
/vote-event create
  title: Best Meme Contest
  description: Vote for your favorite meme!
  min_participants: 3
  max_participants: 20
  prize_amount: 5
  currency: USD
  duration_minutes: 60
  image1: [upload]
  image2: [upload]
  image3: [upload]
```

### `/vote-event list`
View all active vote events in the server

### `/vote-event info`
View detailed information about a specific vote event

**Parameters:**
- `event_id`: The vote event ID

### `/vote-event remove`
Remove a vote event (Server Owner only)

**Parameters:**
- `event_id`: The vote event ID to remove
- `reason`: Optional reason for removal

## Event Lifecycle

1. **Creation**: Server owner creates event with images and settings
2. **Joining Phase**: Participants join the event (requires wallet connection)
3. **Voting Phase**: Participants cast their votes via dropdown menu
4. **Event End**: Triggered by timer, OR automatically when all participants have submitted their votes (voting-complete triggers immediate processing)
5. **Results**: Winners determined, prizes distributed, results announced

## Event Card Display

The event card shows:
- All images with links to view them
- Current participant count vs max
- Minimum participants needed
- Prize pool (if set)
- Countdown timer (if set)
- Vote participation status
- Interactive buttons and dropdown for joining/voting

## Results Display

When event ends, results show:
- Total participants and votes cast
- Vote breakdown by image with percentages
- Winning image
- List of winners
- Prize distribution with transaction links
- Payment verification

## Database Schema

### vote_events
Stores vote event information including settings, participant counts, and status.

### vote_event_images
Stores images with auto-generated IDs and display order.

### vote_event_participants
Tracks who joined, their votes, and winner status.

## Technical Details

### Image ID Generation
- Format: `IMG-{timestamp}-{random}-{order}`
- Random component prevents collisions even in rapid succession
- Order number maintains display sequence

### Transaction Safety
- Join operation uses database transaction to ensure atomicity
- Participant count and entry creation are atomic
- Prevents race conditions and inconsistent state

### Automated Payouts
- Runs every 30 seconds checking for expired events
- Validates minimum participants before processing
- Calculates winners based on voting logic
- Distributes prizes from guild treasury wallet
- Records all transactions with signatures
- Handles payment failures gracefully

### Wallet Requirements
- Participants must have connected wallet via `/user-wallet connect`
- Payment failures are logged and displayed in results
- Server must have configured treasury wallet

## Security Considerations

- Only server owner can create/remove vote events
- Image IDs are generated server-side (not user input)
- Votes are final and cannot be changed
- Owner's favorite is kept private until results
- All database operations use parameterized queries
- Transaction atomicity prevents data corruption

## Testing

All core functionality has been tested:
- ✅ Event creation with multiple images
- ✅ Image ID generation and storage
- ✅ Participant joining with wallet validation
- ✅ Vote submission and tracking
- ✅ Vote result calculation
- ✅ Winner determination (both modes)
- ✅ Event status updates
- ✅ Data cleanup on deletion
- ✅ Transaction safety for join operation

## Deployment

The feature is production-ready and will be deployed to Railway along with all other commands. Once deployed:
1. Bot will automatically load the new command
2. Database tables will be created on first run
3. Vote event checker will start monitoring for expired events
4. Command will appear in Discord's slash command menu

## Future Enhancements

Potential improvements for future versions:
- Multiple images per vote option
- Weighted voting
- Ranked choice voting
- Image galleries in embeds
- Vote history tracking
- Leaderboards
