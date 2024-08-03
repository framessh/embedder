#!/bin/sh
DIR_PATH=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )

# Pre-requisites for chrome headless
sudo apt-get update
sudo apt-get install software-properties-common
sudo add-apt-repository ppa:canonical-chromium-builds/stage
sudo apt-get update
sudo apt-get install chromium-browser 
sudo apt-get install xdg-utils
sudo ln -s /etc/apparmor.d/opt.google.chrome.chrome opt.google.chrome.chrome
sudo ln -s /etc/apparmor.d/usr.bin.chromium-browser usr.bin.chromium-browser
sudo invoke-rc.d apparmor reload

# Install node v18.12.1
curl -sL https://deb.nodesource.com/setup_18.x -o nodesource_setup.sh
sudo bash nodesource_setup.sh
sudo apt install nodejs -y
node -v

cd $DIR_PATH
npm install
ufw allow 443

cp proxy.service.sample proxy.service 