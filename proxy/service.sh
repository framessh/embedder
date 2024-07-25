#!/bin/sh
DIR_PATH=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )

cp -rf ./proxy.service /etc/systemd/system
systemctl start proxy.service 
systemctl enable proxy.service