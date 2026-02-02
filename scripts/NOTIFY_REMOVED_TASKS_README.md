# Retroactive Bulk Task Removal Notifications

This script allows you to send notifications to members about bulk tasks that were removed before the notification feature was implemented.

## Setup

1. Open `scripts/notify-removed-tasks.js`
2. Edit the `REMOVED_TASKS` array with information about the tasks that were removed today:

```javascript
const REMOVED_TASKS = [
  {
    taskId: 1,                              // The bulk task ID that was removed
    title: 'Add Discrypto Bot',             // Task title
    payoutAmount: 1,                         // Payout amount
    payoutCurrency: 'USD',                   // Currency (SOL/USD)
    reason: 'Task completed',                // Reason for removal
    guildId: '1459252801464041554',         // Your Discord server ID
    channelId: '1234567890123456',          // Channel to post notification in
    affectedUsers: ['user1', 'user2']       // (Optional) User IDs who claimed
  },
  // Add more tasks here
];
```

## Getting the Required Information

### Task Information
You'll need to know:
- **taskId**: The bulk task ID that was removed
- **title**: The task title
- **payoutAmount** and **payoutCurrency**: From when you created the task
- **reason**: Why the task was removed (e.g., "Task completed", "Duplicate task", etc.)

### Channel ID
To get the channel ID where you want to post the notification:
1. Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
2. Right-click the channel → Copy Channel ID

### User IDs (Optional)
If you want to mention specific users who claimed the task:
1. Right-click on the user → Copy User ID
2. Add their IDs to the `affectedUsers` array
3. If you don't know who claimed, you can:
   - Leave the array empty: `affectedUsers: []`
   - Or omit it entirely and it will use `@here` instead

## Running the Script

### Local Testing (Windows)
```powershell
cd "c:\Users\Brody\Downloads\discord-crypto-task-payroll-bot"
node scripts/notify-removed-tasks.js
```

### On Railway
1. Commit and push the script
2. Open Railway dashboard
3. Go to your bot service
4. Click on "Deployments" → Select latest deployment
5. Open terminal and run:
```bash
node scripts/notify-removed-tasks.js
```

## Example Configuration

```javascript
const REMOVED_TASKS = [
  {
    taskId: 4,
    title: 'Social Media Verification',
    payoutAmount: 5,
    payoutCurrency: 'USD',
    reason: 'Task period ended',
    guildId: '1459252801464041554',
    channelId: '1320771717645987840',
    affectedUsers: ['352159046503464960', '718492345678901234']
  },
  {
    taskId: 5,
    title: 'Discord Server Boost',
    payoutAmount: 0.1,
    payoutCurrency: 'SOL',
    reason: 'Duplicate of another task',
    guildId: '1459252801464041554',
    channelId: '1320771717645987840',
    // No affectedUsers = will use @here
  }
];
```

## Safety Notes

- The script only **sends notifications** - it doesn't modify any database
- You can run it multiple times safely (though members might get duplicate notifications)
- Test with one task first before adding multiple
- Make sure the bot has permission to post in the specified channels
