FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg && npm install --global @higgsfield/cli@1.1.20
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
RUN test -s ./public/niannian-ai-mark-transparent.svg \
    && test -s ./public/media/generated/workbench-luxury-nocturne-c-rh/workbench-mineral-flow-v2.mp4
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/lib/video-output-gate.mjs ./lib/video-output-gate.mjs
COPY --from=build /app/lib/legacy-mimo-delivery-backfill.mjs ./lib/legacy-mimo-delivery-backfill.mjs
COPY --from=build /app/lib/video-cos.ts ./lib/video-cos.ts
# Runtime task data and generated bundles are deployment state, not image inputs.
RUN mkdir -p ./runtime
EXPOSE 3026
CMD ["npm", "run", "start"]
