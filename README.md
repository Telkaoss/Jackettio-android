# Android port of the Stremio addon "Jackettio"

**ATTENTION:** jackett is not working at the moment, I'm working on it
*The Mono version of Termux has problems with TLS. Therefore, "jackett" will not be able to search on trackers.
That being said, you can try with Proot. I haven't had time to try it yet. I wanted jackettio to work natively on Termux without emulating a Linux distribution*

#
**Install Termux and copy this:**
```
pkg update && pkg upgrade && pkg install -y nodejs-lts git && git clone https://github.com/Telkaoss/Jackettio-android.git && cd Jackettio-android/

```
**After that, to install:** 
```
npm install
```
*(if you get an error with localtunnel, restart session Termux)*

**To launch without install:**
```
npm start
```
*If you start a jackettio session with npm install or start, restart the application to start it again. (port 4000 and 9117 will be blocked)*

**The addon is here :**

```
cd Jackettio-android/
```
**Enjoy**

