# Post-Coding Review: Real I2V Pre-Generate Gates

- Real path checked: the claimed `NIANNIAN-WB-REAL-I2V-4S-20260728-01` Windows Mimo submission path now requires visible, semantic `image_to_video`, `Seedance 2.0`, `4s`, and `16:9` selection/readback, native-audio readback, and visible cost before `generate.click()`.
- Content binding checked: fresh-task staging requires the exact authorized face-preprocess manifest, rejects the locked original SHA as the upload reference, and rehashes staged bytes against the manifest derived SHA; receipt-bearing tasks remain sync-only.
- Evidence: `npm run test:real-i2v-hard-gates` passed 11/11; `npm run worker:mimo-windows:contract` passed; `npm run lint` passed (`tsc --noEmit`); an independent read-only acceptance reviewed the same gates and passed.
- Not executed: no Docker/OpenCV runtime, Windows candidate deployment, private face-service deployment, live Mimo UI/cost check, task creation, credit reservation, Provider submission, or production delivery. The earliest missing downstream artifact is a deployable, live-verified private face processor and Windows candidate under the controlled deployment gate.
