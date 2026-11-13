---
'@selvajs/selva': patch
'@selvajs/server': patch
'@selvajs/supabase-provider': patch
---

Deleting or disabling a user no longer leaves a gap nobody can repair. Disable now refuses an org's only owner, as delete does, and neither they nor an owner stepping down or being removed count a disabled co-owner as the one who stays. Both run their owner check inside the org's member-change queue, so an owner stepping down while their co-owner is deleted cannot leave the org without one. A disable or delete that fails gives the target their `instance_admin` grant back. Delete erases the user's data before the identity, so a retry after a failed erasure finishes the job instead of answering 404 with the data still there, then erases again for what the user's live session wrote meanwhile. `@selvajs/server/handlers` exports `serializeOwnerChanges` and `orgHasAnotherOwner`.

Supabase: a sign-out, disable or delete on one instance now ends that user's sessions there on their next request, instead of up to 60 seconds later. Other instances still take up to `revalidateMs`.
