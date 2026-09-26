Recorded 2026-09-26 with curl from the live endpoints. Kept as returned except:
`ema-shortages.json` is trimmed to 6 of the 85 rows (meta.total_records set to 6 to match).

- cpsc-crib.json: saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2026-08-01&ProductName=crib
- openfda-food-peanut.json: api.fda.gov/food/enforcement.json?search=product_description:peanut&limit=3&sort=report_date:desc
- openfda-drug-ibuprofen.json: api.fda.gov/drug/enforcement.json?search=product_description:ibuprofen&limit=3&sort=report_date:desc
- openfda-device-thermometer.json: api.fda.gov/device/enforcement.json?search=product_description:"thermometer"&limit=2&sort=report_date:desc
- openfda-not-found.json: openFDA's HTTP 404 body for a search with no matches
- ema-shortages.json: ema.europa.eu/en/documents/report/shortages-output-json-report_en.json
