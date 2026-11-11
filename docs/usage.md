# Using the inbox

## Signing in

Open the inbox URL your administrator gave you. Cloudflare Access asks you to sign in, for example with your company Google or Microsoft account. You then land directly in your own inbox. If you have access to several mailboxes (e.g. a shared `support@` box), you first get a list to pick from.

You only ever see mail for your own mailbox(es).

To sign out, click the **Sign out** icon at the top right.

## Layout

- **Left sidebar**: *Compose*, your folders (Inbox, Sent, Drafts, Archive, Trash, plus any folders you create), and unread counts.
- **Top bar**: search, the address you're signed in as, settings, and sign out.
- **Main area**: the message list, with the open conversation beside it.

On a phone, the sidebar opens from the ☰ menu.

## Reading mail

- Click a message to open the whole conversation. Replies are grouped into threads.
- Opening a conversation marks it as read.
- Attachments are listed under the message. Click one to download it.
- Remote content in emails is shown in a sandboxed frame.
- Use the message toolbar to **star**, **archive**, **move** to a folder, **delete**, or view the original **headers**.

## Writing mail

1. Click **Compose**.
2. Fill in *To* (and *Cc* / *Bcc* if needed), *Subject*, and your message. The editor supports bold, italics, lists, links, colours and images.
3. Click **Send**.

> The composer doesn't have a file-upload button yet. The API accepts attachments (see [Architecture](./architecture.md#api)), and attachments you receive can be downloaded.

The message goes out straight away. If the mail server refuses it (for example the recipient address doesn't exist or the sending limit is reached), you'll see an error and the message is **not** placed in Sent, so you can fix it and try again.

**Reply**, **Reply all** and **Forward** are in the conversation toolbar. Replies quote the original and stay in the same thread for the recipient.

### Drafts

Click **Save as Draft** in the composer to keep an unfinished message in **Drafts**. Open a draft to continue editing or send it.

### Sending limits

Each mailbox can send up to 20 messages per hour and 100 per day.

## Search

Type in the search bar and press Enter. You can mix plain words with filters:

| Filter | Example |
| --- | --- |
| `from:` | `from:alice` |
| `to:` | `to:bob@example.com` |
| `subject:` | `subject:invoice` |
| `is:unread` / `is:read` | `is:unread` |
| `is:starred` | `is:starred` |
| `has:attachment` | `has:attachment report` |
| `in:` | `in:archive` |
| `before:` / `after:` | `after:2026-01-01` |

## Folders

Create a folder with **+** next to *Folders* in the sidebar, then move messages into it from the toolbar. You can rename or delete your own folders. The built-in folders can't be deleted.

## Settings

Click the gear icon to change your **display name**, the name recipients see next to your address.
