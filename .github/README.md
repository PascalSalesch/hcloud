# pascalsalesch/hcloud

[![.github/workflows/dry-run.yml](https://github.com/PascalSalesch/hcloud/actions/workflows/dry-run.yml/badge.svg)](https://github.com/PascalSalesch/hcloud/actions/workflows/dry-run.yml)

A declarative approach to managing Hetzner Cloud resources.

- [GitHub Action](#github-action)
- [Command Line Interface](#command-line-interface)
- [hcloud.yml](#hcloudyml)
  - [File Structure](#file-structure)
  - [Types](#types)
  - [Variables](#variables)



## GitHub Action

Create a GHA workflow file to either construct a server cluster or update the running services in response to supported events.
The following example prints out the manual for each command:

```yaml
- uses: pascalsalesch/hcloud@latest
  with:
    run: |
      create_server_config --help
      create_service_config --help
      create_proxy_config --help
```

A running example can be found [here](../.github/workflows/dry-run.yml).


### Inputs

| Name               | Description                                 | Type             | Required            |
| ------------------ | ------------------------------------------- | ---------------- | ------------------- |
| run                | The commands to run                         | multiline string | :heavy_check_mark:  |
| hcloud_token       | The Hetzner token for authentication        | string           | :x:                 |
| github_workspace   | GitHub workspace to use                     | string           | :x:                 |
| github_token       | GitHub token for authentication             | string           | :x:                 |
| github_actor       | GitHub actor for authentication             | string           | :x:                 |



## Command Line Interface

Please use the following commands to see the manual:

```bash
npm -s start -- create_server_config --help
npm -s start -- create_service_config --help
npm -s start -- create_proxy_config --help
```


### Example (dry run)

You can execute this example to take a look at the generated output files.
Download this repository and run the following command in the root directory:

```bash
npm -s start -- create_server_config examples/hcloud.yml --dryRun
npm -s start -- create_service_config examples/hcloud.yml examples --dryRun
npm -s start -- create_proxy_config examples/hcloud.yml examples --dryRun
```

If you forgot to add the `--dryRun` flag, you can delete the terraform setup by running `terraform destroy` in the `dist` directory.



### Example

Per default the output is set to `dist`. Live commands look like this:

```bash
npm -s start -- create_server_config examples/hcloud.yml
npm -s start -- create_service_config examples/hcloud.yml dist
npm -s start -- create_proxy_config examples/hcloud.yml dist
```



## hcloud.yml

An example configuration file can be found [here](../examples/hcloud.yml).

- [File Structure](#file-structure)
- [Types](#types) 
- [Variables](#variables)



### File Structure

| Field         | Type                                | Required           | Default | Description                                   |
| ------------- | ----------------------------------- | ------------------ | ------- | --------------------------------------------- |
| `servers`     | Object<string, [server](#server)>   | :heavy_check_mark: |         | Configuration for creating servers.           |
| `services`    | Object<string, [service](#service)> | :heavy_check_mark: |         | Configuration for creating services.          |
| `ssh_keys`    | Object<string, [ssh_key](#ssh_key)> | :heavy_check_mark: |         | Configuration for creating SSH keys.          |
| `volumes`     | Object<string, [volume](#volume)>   | :x:                | _none_  | Configuration for creating volumes.           |


#### `ssh_key`

| Field         | Type       | Required | Default | Description                                                                       |
| ------------- | ---------- | -------- | ------- | --------------------------------------------------------------------------------- |
| `public_key`  | `string`   | :x:      |         | Public key of the SSH key. One of `private_key` or `public_key` must be set.      |
| `private_key` | `string`   | :x:      |         | Private key of the SSH key. One of `private_key` or `public_key` must be set.     |
| `user`        | `string`   | :x:      | `root`  | User associated with the SSH key.                                                 |


#### `server`

| Field         | Type                     | Required           | Default                   | Description                                                     |
| ------------- | ------------------------ | ------------------ | ------------------------- | --------------------------------------------------------------- |
| `server_type` | `string`                 | :heavy_check_mark: |                           | Type of the server.                                             |
| `ssh_keys`    | `keyof(ssh_keys)[]`      | :heavy_check_mark: |                           | SSH keys to be added to the server.                             |
| `services`    | `keyof(services)[]`      | :heavy_check_mark: |                           | Services to be added to the server.                             |
| `volumes`     | `keyof(volumes)[]`       | :x:                | _none_                    | Volumes to be mounted.                                          |
| `location`    | `string`                 | :x:                | _Hetzner Cloud default_   | Location of the server.                                         |
| `ports`       | `number[]`               | :x:                | _all service ports_       | Ports to be exposed.                                            |
| `environment` | `Object<string, string>` | :x:                | _none_                    | Environment variables to be added to all services.              |


#### `volume`

| Field         | Type       | Required           | Default                 | Description                                   |
| ------------- | ---------- | -------------------| ----------------------- | --------------------------------------------- |
| `size`        | `number`   | :heavy_check_mark: |                         | Size of the volume in GB.                     |
| `path`        | `string`   | :heavy_check_mark: |                         | Path where the volume should be mounted.      |


#### `service`

| Field         | Type                              | Required           | Default           | Description                                              |
| ------------- | --------------------------------- | -------------------| ----------------- | -------------------------------------------------------- |
| `images`      | [image_string](#image_string)[]   | :heavy_check_mark: |                   | Images to be used for the service.                       |
| `ports`       | [port_string](#port_string)[]     | :x:                | _all image ports_ | Ports to be exposed to the internet.                     |
| `proxies`     | [proxy_string](#proxy_string)[]   | :x:                | _none_            | Reverse proxy configuration for the service.             |
| `environment` | `Object<string, string>`          | :x:                | _none_            | Environment variables for all images.                    |
| `volumes`     | [volume_string](#volume_string)[] | :x:                | _none_            | Volumes to be exposed to the host machine.               |



### Types

- [image_object](#image_object)
- [image_string](#image_string)
- [port_string](#port_string)
- [proxy_string](#proxy_string)
- [volume_string](#volume_string)


#### `image_object`

An object representing an image.

| Field     | Type       | Description                                    |
| --------- | ---------- | ---------------------------------------------- |
| `domain`  | `string`   | Domain of the image.                           |
| `path`    | `string`   | Path of the image.                             |
| `version` | `string`   | Tag of the image.                              |


#### `image_string`

A string representing one or more images, usually in the format `ghcr.io/${org}/${repo}:${tag}`.
Each field can be omitted. Only an empty string is not allowed.

| Example         | Organization     | Repository             | Tag        |
| --------------- | ---------------- | ---------------------- | ---------- |
| latest          | Current user     | Current repository     | latest     |
| test:latest     | Current user     | test                   | latest     |
| org/test:v1     | org              | test                   | v1         |
| org/\*:v1       | org              | _All repositories_     | v1         |
| org/test:\*     | org              | test                   | _All tags_ |
| org/\*:\*       | org              | _All repositories_     | _All tags_ |


#### `port_string`

A string mapping a port from the host machine to a port on the container, usually in the format `${public_port}:${host_port}:${container_port}`.

| Template literal | Required           | Default          | Description                                   |
| ---------------- | ------------------ | ---------------- | --------------------------------------------- |
| `public_port`    | :x:                | 80               | Port exposed via the proxy.                   |
| `host_port`      | :x:                | _dynamic_        | Port on the container.                        |
| `container_port` | :x:                | _public port_    | Port on the container.                        |

If `host_port` is omitted, the port will be dynamically assigned by the host machine.
If `host_port` is equal to `public_port`, the creation of the proxy will be skipped.

Port Examples:
 - `80`: Expose port `80` to the public and bind it to port `80` on the container.
 - `80:8080`: Expose port `80` to the public and map it to port `8080` on the container.
 - `80:4000:8080`: Expose port `80` to the public and bind it to port `4000` on the host machine and port `8080` on the container.


#### `proxy_string`

A string representing a reverse proxy configuration, usually in the format `${strategy}://${domain}:${port_string}/${path}`.

| Template literal            | Required           | Default          | Description                                   |
| --------------------------- | ------------------ | ---------------- | --------------------------------------------- |
| `strategy`                  | :x:                | least_conn       | Load balancing strategy.                      |
| `domain`                    | :heavy_check_mark: |                  | Nginx domain configuration.                   |
| [port_string](#port_string) | :x:                | `80`             | Port configuration.                           |
| `path`                      | :x:                | /                | Path to be used for the service.              |

Load Balancing strategies:
 - `static`: Always use the host machine that is currently connected. No load balancing.
 - `round-robin`: Use the host machine in a round-robin fashion.
 - `ip_hash`: Use the host machine based on the IP address of the client.
 - `least_conn`: Use the host machine with the least connections.


#### `volume_string`

A string representing a volume, usually in the format `${host_path}:${container_path}`.
For example: `/data:/var/lib/postgresql/data`. Mounts the host machine's `/data` directory to the container's `/var/lib/postgresql/data` directory.



### Variables

Variables should be declared as template literals, starting with `${` and ending with `}`.

| Variable   | Type                             | Context             | Description                                       |
| ---------- | -------------------------------- | ------------------- | ------------------------------------------------- |
| `env`      | `Object<string, string>`         | _global_            | Environment variables of the current process.     |
| `file`     | `(filename: string) -> string`   | _global_            | Function returning the content of a file.         |
| `hostname` | `(hostname: string) -> string`   | _global_            | Function formatting a string as a hostname.       |
| `server`   | [server](#server)                | [service](#service) | Server the service is running on.                 |
| `image`    | [image_object](#image_object)    | [service](#service) | Object representing the image for the service.    |
