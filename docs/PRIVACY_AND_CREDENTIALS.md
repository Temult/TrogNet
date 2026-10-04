# Privacy and credentials

The scaffold stores no credentials and requires no repository secrets. Publication
checks run locally with the Python standard library. They upload no source to a
third-party scanning service and print no matching credential values.

Never commit tokens, keys, user-specific account settings, local absolute paths, or
private research/evidence data. Use visibly synthetic values and placeholders.
The ignore file is convenience only: the hygiene checker also inspects ignored files
present in the working directory. Run it in a clean checkout.

Future runtime credential persistence, refresh, encryption, redaction, retention,
deletion, and local projection access require E05R1 review. There is no implementation
or guarantee of these behaviors in this scaffold. Keep all review evidence and
owner-specific receipts outside the repository.
