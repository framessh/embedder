#!/bin/sh
DIR_PATH=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )

# Chromium dependency
sudo apt-get install -yq --no-install-recommends libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 libnss3 
sudo apt-get install chromium-browser
sudo apt-get install libcap2-bin 
sudo setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))

# Install node v18.12.1
curl -sL https://deb.nodesource.com/setup_18.x -o nodesource_setup.sh
sudo bash nodesource_setup.sh
sudo apt install nodejs -y
node -v

cd $DIR_PATH
npm install
ufw allow 443

cp proxy.service.sample proxy.service 