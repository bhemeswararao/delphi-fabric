#!/usr/bin/env bash
set -e
CURRENT=$(cd $(dirname ${BASH_SOURCE}) && pwd)
export binPath=$CURRENT/common/bin/
down() {
	action=down node ./dockerode-bootstrap.js
	sudo rm -rf $CURRENT/stateVolumes/*
}
up() {
	prepareNetwork
	taskID=0 channelName=allchannel node app/channelSetup.js
	taskID=1 channelName=allchannel node app/channelSetup.js
	taskID=2 channelName=allchannel node app/channelSetup.js
	channelName=extrachannel node app/channelSetup.js
}

prepareNetwork() {
	action=up node ./dockerode-bootstrap.js
}
restart() {
	down
	up
}
repeat() {
	local times=5
	for ((i = 1; i <= times; i++)); do
		./docker.sh
	done
}
if [[ -z "$1" ]]; then
	restart
else
	$1
fi
