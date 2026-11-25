# Naming devices

The default convention for the device names an agent proposes, and the limits the server puts on a name.

## The convention

This is a default. The operator may change it or ask you to use another. If the operator gives a convention, follow it.

- A personal device is named person-type: `anna-phone`, `anna-laptop`.
- A shared device is named room-type: `kitchen-tv`, `office-printer`.
- Write lowercase letters, digits and hyphens. Use no accents and no spaces.
- Add a number at the end when the name is taken: `anna-phone-2`.
- Use the operator's language for the words. In Italian a kitchen TV is `cucina-tv`.

The device name carries the identity. Who uses the device, or where it stands, is in the name, so no other field needs it.

You cannot set an owner label or a device note, and you do not see them: Warden refuses a plan that tries, and no read tool returns them. The operator writes them.

Do not guess a name. `list_devices` gives an unmapped device's address, MAC address and vendor, not who uses it. Ask the operator what the device is and who uses it, then propose the name and let the operator confirm. A name that holds a person's first name is data that leaves the host (see the safety topic). If the operator prefers no personal names, use a role, as in `parent-phone`.

## What the server does with a name

- Warden derives the device id from the name. The id has only the letters a to z, the digits 0 to 9 and the hyphen, and at most 64 characters.
- Every other character becomes a hyphen. A run of them becomes one, and a hyphen at either end is dropped. A space, an underscore and an accented letter are all such characters, so an accented letter splits or shortens the name. Write the plain letter.
- A name with no letter and no digit gives an empty id and is refused. So is a name with a control, bidi or invisible character.
- Two names that give the same id are the same device name. The server refuses the second as a duplicate, so `Anna Phone` and `anna-phone` collide. Pick the next number, or update the device that has the name.
- Keep names well under 64 characters. A longer name is cut, and two long names can end up with the same id.

## A device Warden has not seen

- The `promote` operation of a plan maps only an address that `list_devices` gives as unmapped, with a MAC that Warden has seen at that address.
- A new device appears there after it has sent queries and Warden has read its MAC. `list_devices` refreshes what Warden sees at most every 30 seconds.
- Before that, `promote` is refused with "Warden has no MAC for IP yet". Call `list_devices` later, then plan again.
- No agent operation adds a device by its MAC. To map a device in advance, the operator runs this on the Warden host, with ID named by the convention above:

```
warden device add ID --mac AA:BB:CC:DD:EE:FF --profile PROFILE
```
