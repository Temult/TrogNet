// Executed only by flock; EOF on the private parent pipe releases the lock.
process.stdin.resume();
process.stdin.once('end',()=>process.exit(0));
process.stdout.write('LOCKED\n');
