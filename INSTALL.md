# Installing Orbit

This takes about two minutes. You don't need to be technical, and you don't need an
administrator password.

**You need:** a Windows 10 or Windows 11 computer.

---

## 1. Download

Go to the [latest Orbit release](https://github.com/Jallad209/Orbit-/releases/latest) and click the
file whose name ends in **`-setup.exe`** (for example `Orbit_1.0.0_x64-setup.exe`). Ignore the
other files — they are for developers.

Your browser may say the file **"isn't commonly downloaded"**. That only means not many people
have downloaded it yet. Choose **Keep**. In Edge: click the **…** next to the warning, then
**Keep**; if it asks again, click **Show more**, then **Keep anyway**.

## 2. Open it — and the blue warning box

Double-click the file you downloaded. Windows will show a blue box that says
**"Windows protected your PC"**.

**This is expected.** Windows shows it for any program that hasn't paid for a publisher
certificate, and Orbit hasn't. It is not a virus warning.

1. Click **More info** (the small link under the message).
2. Click **Run anyway**.

You only see this once.

## 3. Install

The Orbit installer opens. Every choice already has the right answer, so just:

1. **Welcome** — click **Next**.
2. **Choose Install Location** — leave the folder as it is and click **Next**.
3. Wait a few seconds for the green bar, then click **Next**.
4. **Finished** — leave both boxes ticked (**Run Orbit** and **Create desktop shortcut**) and
   click **Finish**.

Orbit opens by itself.

> On a few older Windows 10 computers, the installer first downloads one small Microsoft
> component that Orbit needs to draw its window. That is automatic; it just takes a little
> longer and needs the internet that one time. Windows 11 already has it.

## 4. The first time Orbit opens

You'll see a welcome screen with three short sections. You can change all of them later, so
it is fine to click **Start planning** straight away.

From then on, open Orbit from the **desktop icon** or from the **Start menu** (type
`Orbit`).

---

## Good to know

**Your information stays on your computer.** Orbit has no account and no sign-in, and it sends
nothing about you or your plans anywhere. Everything is kept in one file on this computer. See
[Privacy](docs/PRIVACY.md) for the details.

**Closing the window doesn't quit Orbit.** It keeps running quietly near the clock (bottom-right
of the screen, sometimes under the **^** arrow) so your reminders can still pop up. To quit
completely, right-click that icon and choose **Quit**.

**Back up now and then.** In Orbit, go to **Settings → Data** and choose **Export everything as
JSON**.
Orbit also keeps its own automatic backups, but a copy you saved yourself is the safest.

## Updating

1. Quit Orbit first: right-click its icon near the clock and choose **Quit**.
2. Download the newer `-setup.exe` the same way and open it.
3. The installer will say **"An older version of Orbit is installed"** and offer two choices.
   Choose **Do not uninstall**, then click **Next**. (The other choice opens the old version's
   uninstaller in the middle of the update — it also keeps your data, but it's an extra
   window you don't need.)
4. Click through the rest as for a first install.

Updating replaces the program and **keeps all your plans, notes and settings**.

## Uninstalling

Open **Settings → Apps → Installed apps**, find **Orbit**, click the **…** next to it, and choose
**Uninstall**.

Uninstalling removes the program but **keeps your data**, in case you reinstall later. If you
want your data gone too, delete this folder afterwards (paste it into the File Explorer address
bar):

```
%APPDATA%\app.orbit.desktop
```

## For the careful: checking your download

Next to the installer on the release page there is a file called `SHA256SUMS.txt`. To confirm
your download is exactly the file that was published, open **PowerShell** and run:

```
Get-FileHash "$HOME\Downloads\Orbit_1.0.0_x64-setup.exe"
```

The long code it prints should match the line for that file in `SHA256SUMS.txt`.
