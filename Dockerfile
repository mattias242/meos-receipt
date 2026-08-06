FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Containern kör annars UTC, och då visar kvittots "Uppdaterat" en annan
# klocka än tävlingens tider – som att kvittot uppdaterats före målgången.
# Alpine saknar tidszonsdata, så den måste installeras för att TZ ska gälla.
RUN apk add --no-cache tzdata
ENV TZ=Europe/Stockholm

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000 DATA_DIR=/data
EXPOSE 3000

CMD ["node", "index.js"]
