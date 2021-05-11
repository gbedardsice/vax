# Vax

Script that checks for vaccination appointments near you

## Usage

```
~ ❯❯❯ npm install -g vax-qc
~ ❯❯❯ vax-qc --postalCode=H0H0H0 --tolerance=5 --distance=10
```

## Options

- `postalCode` - The reference postal code to search around (mandatory)
- `tolerance` - Check for appointments in the next X days (defaults to 5, optional)
- `distance` - Max distance away from postalCode in km (defaults to 10, optional)
- `poll` - Polling refresh rate in minutes (defaults to 1, optional)
- `specificDate` - Looks for appointments on a specific date in the YYYY-MM-DD format. If provided, `tolerance` option will be ignored. (optional)

## Example

https://user-images.githubusercontent.com/680623/117833521-6790df80-b244-11eb-8651-2951e040a99d.mov
