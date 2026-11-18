# Security Specification — ClipPulse Studio

## 1. Data Invariants
1. A `UserProfile` document at `/users/{userId}` can only be read, created, or updated by `request.auth.uid == userId` with a verified email.
2. A `YouTubeChannel` document at `/channels/{channelId}` belongs strictly to `ownerId == request.auth.uid`; `ownerId` and `createdAt` are immutable after creation.
3. An `AutomationJob` document at `/automationJobs/{jobId}` must reference an existing `channelId` owned by `request.auth.uid` on creation; `ownerId`, `channelId`, and `createdAt` are immutable after creation; once `status == 'published'`, updates are locked.
4. No blanket `list` queries are permitted — every `allow list` validates `resource.data.ownerId == request.auth.uid`.
5. All string fields enforce `.size()` bounds and arrays enforce bounded `.size() <= MAX` limits.

## 2. Adversarial Test Payloads ("Dirty Dozen")
1. **Identity Spoofing on User Create**: `uid` set to another user's UID -> DENIED.
2. **Unverified Email Write**: `request.auth.token.email_verified == false` -> DENIED.
3. **Ghost Shadow Field on Channel**: Extra field `isAdmin: true` in payload -> DENIED via `keys().hasOnly(...)`.
4. **Channel Owner Hijack on Update**: Changing `ownerId` on existing channel -> DENIED.
5. **Cross-User PII Read**: Reading `/users/{otherUserId}` -> DENIED.
6. **Blanket List Scrape**: Listing `/channels` without `ownerId == request.auth.uid` filter -> DENIED.
7. **Orphaned AutomationJob**: Creating job referencing non-existent or other user's `channelId` -> DENIED via `get()` check.
8. **1MB String Resource Poisoning**: `title` > 120 chars or `captionsPayload` > 16000 chars -> DENIED.
9. **Path ID Poisoning**: Document ID containing `/` or spaces or > 128 chars -> DENIED via `isValidId()`.
10. **Unbounded Array Injection**: `postingSlots.size() > 2` or `copyrightFreeTransforms.size() > 6` -> DENIED.
11. **Terminal State Mutation**: Updating an `automationJob` whose existing `status == 'published'` -> DENIED.
12. **Client Timestamp Forgery**: `createdAt != request.time` or `updatedAt != request.time` -> DENIED.
